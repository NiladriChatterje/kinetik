import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { ERROR_CODES, PREMIUM_SWIPE_LIMIT_DAILY, PREMIUM_MONTHLY_COST_INR, getPricingForPhone } from '@kinetik/shared';
import { query, TABLES, getSubscription } from '../services/database';
import { eventBus } from '../services/eventBus';
import { getRedis } from '../services/redis';
import {
  isRazorpayConfigured,
  createPremiumSubscription,
  fetchSubscription,
  cancelPremiumSubscription,
  verifySubscriptionSignature,
} from '../services/razorpay';

const CreateOrderSchema = z.object({
  amount: z.number().positive(),
  currency: z.string().length(3).default('INR'),
  description: z.string().optional(),
});

const VerifyPaymentSchema = z.object({
  razorpayPaymentId: z.string(),
  razorpayOrderId: z.string(),
  razorpaySignature: z.string(),
});

const VerifySubscriptionSchema = z.object({
  razorpayPaymentId: z.string(),
  razorpaySubscriptionId: z.string(),
  razorpaySignature: z.string(),
});

export async function paymentRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      reply.status(401).send({
        success: false,
        error: { code: ERROR_CODES.UNAUTHORIZED, message: 'Authentication required' },
      });
    }
  });

  // ─── Create Razorpay Order ───────────────────────────
  app.post('/create-order', async (request: FastifyRequest, reply: FastifyReply) => {
    const validation = CreateOrderSchema.safeParse(request.body);
    if (!validation.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'Invalid payment details',
          details: validation.error.flatten(),
        },
      });
    }

    const { sub: userId } = request.user as any;
    const { amount, currency, description } = validation.data;

    // In production, create order via Razorpay API
    // const razorpayOrder = await razorpay.orders.create({ amount, currency, receipt: userId });

    // Store pending order in DB
    const result = await query(
      `INSERT INTO ${TABLES.TRANSACTIONS} (user_id, amount, currency, status, description)
       VALUES ($1, $2, $3, 'created', $4)
       RETURNING id, amount, currency, status, created_at`,
      [userId, amount, currency, description || 'Payment'],
    );

    return reply.send({
      success: true,
      data: {
        transactionId: result.rows[0].id,
        amount: result.rows[0].amount,
        currency: result.rows[0].currency,
        // In production: razorpayOrderId: razorpayOrder.id,
        razorpayOrderId: `order_${result.rows[0].id}`,
        razorpayKeyId: process.env.RAZORPAY_KEY_ID,
      },
    });
  });

  // ─── Verify Payment ──────────────────────────────────
  app.post('/verify', async (request: FastifyRequest, reply: FastifyReply) => {
    const validation = VerifyPaymentSchema.safeParse(request.body);
    if (!validation.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'Invalid verification data',
          details: validation.error.flatten(),
        },
      });
    }

    const { sub: userId } = request.user as any;
    const { razorpayPaymentId, razorpayOrderId, razorpaySignature } = validation.data;

    // In production, verify signature using Razorpay utility
    // const isValid = razorpay.utils.verifyPaymentSignature({
    //   order_id: razorpayOrderId,
    //   payment_id: razorpayPaymentId,
    //   signature: razorpaySignature,
    // });

    const isValid = true; // Simplified for dev

    if (!isValid) {
      return reply.status(400).send({
        success: false,
        error: { code: ERROR_CODES.PAYMENT_FAILED, message: 'Payment verification failed' },
      });
    }

    // Update transaction
    await query(
      `UPDATE ${TABLES.TRANSACTIONS} 
       SET razorpay_payment_id = $1, razorpay_order_id = $2, status = 'completed'
       WHERE razorpay_order_id = $3`,
      [razorpayPaymentId, razorpayOrderId, razorpayOrderId],
    );

    await eventBus.sendPaymentEvent({
      type: 'payment.completed',
      payload: { userId, razorpayPaymentId, razorpayOrderId },
    });

    return reply.send({
      success: true,
      data: { verified: true, paymentId: razorpayPaymentId },
    });
  });

  // ─── Get Pricing (user's local currency) ──────────────
  // Returns the subscription price in the user's detected currency based
  // on their phone number country code.
  app.get('/pricing', async (request: FastifyRequest, reply: FastifyReply) => {
    const { sub: userId } = request.user as any;

    // Fetch user's phone number to detect country
    const userResult = await query(`SELECT phone FROM ${TABLES.USERS} WHERE id = $1`, [userId]);
    const phone = userResult.rows[0]?.phone;

    const pricing = getPricingForPhone(phone || '');

    return reply.send({
      success: true,
      data: {
        currency: pricing.currency,
        symbol: pricing.symbol,
        amount: pricing.amountMajor,
        amountMinor: pricing.amountMinor,
        label: pricing.label,
      },
    });
  });

  // ─── Create Subscription (Razorpay recurring plan) ────
  // Creates a Razorpay subscription for the premium plan in the user's
  // local currency. The client then opens the Razorpay Checkout with the
  // returned subscription_id so the user can pay by card or set up a
  // UPI Autopay mandate.
  app.post('/subscription', async (request: FastifyRequest, reply: FastifyReply) => {
    const { sub: userId } = request.user as any;

    if (!isRazorpayConfigured()) {
      return reply.status(503).send({
        success: false,
        error: {
          code: ERROR_CODES.PAYMENT_FAILED,
          message: 'Payments are not configured on the server yet. Please try again later.',
        },
      });
    }

    try {
      // Fetch user's phone to detect currency
      const userResult = await query(`SELECT phone FROM ${TABLES.USERS} WHERE id = $1`, [userId]);
      const phone = userResult.rows[0]?.phone;
      const pricing = getPricingForPhone(phone || '');

      const subscription = await createPremiumSubscription(userId, phone);

      // Remember the subscription on the ledger so /subscription/verify can
      // confirm it actually belongs to this user, and status shows 'pending'.
      await query(
        `INSERT INTO ${TABLES.SUBSCRIPTION_LEDGER} (user_id, razorpay_subscription_id, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (user_id) DO UPDATE SET razorpay_subscription_id = $2, updated_at = NOW()`,
        [userId, subscription.id],
      );

      return reply.send({
        success: true,
        data: {
          subscriptionId: subscription.id,
          razorpayKeyId: process.env.RAZORPAY_KEY_ID,
          amount: pricing.amountMajor,
          currency: pricing.currency,
          label: pricing.label,
          period: 'monthly',
        },
      });
    } catch (error: any) {
      console.error('[payments] Failed to create Razorpay subscription:', error?.message || error);
      return reply.status(502).send({
        success: false,
        error: {
          code: ERROR_CODES.PAYMENT_FAILED,
          message: 'Could not start the subscription. Please try again.',
        },
      });
    }
  });

  // ─── Verify Subscription Payment ──────────────────────
  // Called by the app after the Razorpay Checkout returns. We verify the HMAC
  // signature over payment_id + subscription_id (documented flow for
  // subscriptions) and confirm the subscription belongs to this user before
  // activating premium. The subscription.charged webhook handles later renewals.
  app.post('/subscription/verify', async (request: FastifyRequest, reply: FastifyReply) => {
    const validation = VerifySubscriptionSchema.safeParse(request.body);
    if (!validation.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'Invalid verification data',
          details: validation.error.flatten(),
        },
      });
    }

    const { sub: userId } = request.user as any;
    const { razorpayPaymentId, razorpaySubscriptionId, razorpaySignature } = validation.data;

    if (!verifySubscriptionSignature({
      paymentId: razorpayPaymentId,
      subscriptionId: razorpaySubscriptionId,
      signature: razorpaySignature,
    })) {
      return reply.status(400).send({
        success: false,
        error: { code: ERROR_CODES.PAYMENT_FAILED, message: 'Payment verification failed' },
      });
    }

    // The subscription must be one we created for this user.
    const ledger = await getSubscription(userId);
    if (!ledger || ledger.razorpay_subscription_id !== razorpaySubscriptionId) {
      return reply.status(400).send({
        success: false,
        error: { code: ERROR_CODES.PAYMENT_FAILED, message: 'Subscription does not match this account' },
      });
    }

    // Ask Razorpay for the authoritative subscription state. 'active' (card
    // charged) and 'authenticated' (UPI mandate set up) both mean the user is
    // entitled to premium; the first real charge follows per the plan schedule.
    let subscription: any;
    try {
      subscription = await fetchSubscription(razorpaySubscriptionId);
    } catch (error: any) {
      console.error('[payments] Failed to fetch subscription:', error?.message || error);
      return reply.status(502).send({
        success: false,
        error: {
          code: ERROR_CODES.PAYMENT_FAILED,
          message: 'Could not confirm the subscription. Please try again.',
        },
      });
    }

    const { status, current_end } = subscription;
    if (status !== 'active' && status !== 'authenticated') {
      return reply.send({
        success: true,
        data: { verified: true, activated: false, status },
      });
    }

    const expiresAt = current_end
      ? new Date(Number(current_end) * 1000)
      : (() => { const d = new Date(); d.setMonth(d.getMonth() + 1); return d; })();

    // Grant premium entitlement
    await query(
      `INSERT INTO ${TABLES.SUBSCRIPTION_LEDGER}
         (user_id, tier, swipe_allowance, fast_passes_remaining, rain_checks_remaining,
          razorpay_subscription_id, expires_at, auto_renew, updated_at)
       VALUES ($1, 'premium', $2, 5, 3, $3, $4, TRUE, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         tier = 'premium',
         swipe_allowance = $2,
         fast_passes_remaining = 5,
         rain_checks_remaining = 3,
         razorpay_subscription_id = $3,
         expires_at = $4,
         auto_renew = TRUE,
         updated_at = NOW()`,
      [userId, PREMIUM_SWIPE_LIMIT_DAILY, razorpaySubscriptionId, expiresAt.toISOString()],
    );

    // Record the first transaction
    await query(
      `INSERT INTO ${TABLES.TRANSACTIONS}
         (user_id, razorpay_payment_id, razorpay_subscription_id, amount, currency, status, description)
       VALUES ($1, $2, $3, $4, 'INR', 'completed', $5)`,
      [userId, razorpayPaymentId, razorpaySubscriptionId, PREMIUM_MONTHLY_COST_INR, 'Kinetik Premium — ₹250/month'],
    );

    // Clear Redis swipe cache so the new allowance applies immediately
    const redis = getRedis();
    await redis.del(`user:${userId}:swipes:daily`);

    await eventBus.sendPaymentEvent({
      type: 'subscription.activated',
      payload: { userId, tier: 'premium', expiresAt, razorpaySubscriptionId },
    });

    return reply.send({
      success: true,
      data: { verified: true, activated: true, tier: 'premium', expiresAt: expiresAt.toISOString() },
    });
  });

  // ─── Subscription Status ──────────────────────────────
  // Lightweight read of the user's ledger for the checkout screen.
  app.get('/subscription/status', async (request: FastifyRequest, reply: FastifyReply) => {
    const { sub: userId } = request.user as any;
    const ledger = await getSubscription(userId);

    if (!ledger || !ledger.razorpay_subscription_id) {
      return reply.send({
        success: true,
        data: { tier: 'free', autoRenew: false, expiresAt: null, subscriptionId: null },
      });
    }

    return reply.send({
      success: true,
      data: {
        tier: ledger.tier,
        autoRenew: Boolean(ledger.auto_renew),
        expiresAt: ledger.expires_at ? new Date(ledger.expires_at).toISOString() : null,
        subscriptionId: ledger.razorpay_subscription_id,
      },
    });
  });

  // ─── Subscription Billing History ─────────────────────
  // Recurring charges recorded for this user (first payment + webhook
  // renewals), newest first — powers the history list on the checkout screen.
  app.get('/subscription/history', async (request: FastifyRequest, reply: FastifyReply) => {
    const { sub: userId } = request.user as any;

    const result = await query(
      `SELECT razorpay_payment_id, amount, currency, status, description, created_at
       FROM ${TABLES.TRANSACTIONS}
       WHERE user_id = $1 AND razorpay_subscription_id IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 36`,
      [userId],
    );

    const payments = result.rows.map((row: any) => ({
      paymentId: row.razorpay_payment_id,
      amount: row.amount !== null ? Number(row.amount) : null,
      currency: row.currency || 'INR',
      status: row.status,
      description: row.description || 'Kinetik Premium',
      paidAt: row.created_at,
    }));

    return reply.send({
      success: true,
      data: {
        payments,
        monthsPaid: payments.filter((p) => p.status === 'completed').length,
      },
    });
  });

  // ─── Cancel Subscription ─────────────────────────────
  // Cancels the Razorpay subscription at the end of the current billing cycle
  // (the user keeps Premium until the date they already paid for, then it
  // stops renewing). The subscription.cancelled webhook later flips the tier
  // to free when the cycle actually ends.
  app.post('/subscription/cancel', async (request: FastifyRequest, reply: FastifyReply) => {
    const { sub: userId } = request.user as any;

    const ledger = await getSubscription(userId);
    const subscriptionId = ledger?.razorpay_subscription_id;
    if (!ledger || !subscriptionId) {
      return reply.status(400).send({
        success: false,
        error: { code: ERROR_CODES.PAYMENT_FAILED, message: 'No active subscription to cancel' },
      });
    }

    try {
      // If it's already cancelled on Razorpay's side (e.g. a previous attempt),
      // skip the API call and just make sure our ledger reflects it.
      const current = await fetchSubscription(subscriptionId);
      const alreadyCancelled = ['cancelled', 'halted'].includes(current.status);

      let status = current.status;
      if (!alreadyCancelled) {
        const cancelled = await cancelPremiumSubscription(subscriptionId);
        status = cancelled.status;
      }

      // Keep premium until the end of the paid cycle; stop auto-renew
      await query(
        `UPDATE ${TABLES.SUBSCRIPTION_LEDGER}
         SET auto_renew = FALSE, updated_at = NOW()
         WHERE user_id = $1`,
        [userId],
      );

      const currentEnd = current.current_end
        ? new Date(Number(current.current_end) * 1000).toISOString()
        : null;

      await eventBus.sendPaymentEvent({
        type: 'subscription.cancelled',
        payload: { userId, razorpaySubscriptionId: subscriptionId, status },
      });

      return reply.send({
        success: true,
        data: { cancelled: true, status, subscriptionId, expiresAt: currentEnd },
      });
    } catch (error: any) {
      console.error('[payments] Failed to cancel subscription:', error?.message || error);
      return reply.status(502).send({
        success: false,
        error: {
          code: ERROR_CODES.PAYMENT_FAILED,
          message: 'Could not cancel the subscription. Please try again.',
        },
      });
    }
  });
}
