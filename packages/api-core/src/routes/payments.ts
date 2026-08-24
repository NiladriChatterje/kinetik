import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { ERROR_CODES, FREE_SWIPE_LIMIT, FREE_CHAT_LIMIT, PREMIUM_SWIPE_LIMIT, PREMIUM_CHAT_LIMIT, getPricingForPhone } from '@kinetik/shared';
import { query, TABLES, getSubscription } from '../services/database';
import { eventBus } from '../services/eventBus';
import {
  isGooglePayConfigured,
  getGooglePayClientConfig,
  createSubscriptionId,
  registerAutopayMandate,
  revokeAutopayMandate,
  PREMIUM_PLAN_PERIOD,
} from '../services/googlePay';

const CreateOrderSchema = z.object({
  amount: z.number().positive(),
  currency: z.string().length(3).default('INR'),
  description: z.string().optional(),
});

const VerifyPaymentSchema = z.object({
  paymentId: z.string(),
  orderId: z.string(),
});

const ActivateSubscriptionSchema = z.object({
  subscriptionId: z.string(),
  // Opaque token from the Google Pay sheet: paymentMethodData.tokenizationData.token
  paymentToken: z.string().min(1),
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

  // ─── Create Payment Order (one-off) ──────────────────
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
        orderId: `order_${result.rows[0].id}`,
        googlePay: getGooglePayClientConfig(),
      },
    });
  });

  // ─── Verify Payment (one-off) ────────────────────────
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
    const { paymentId, orderId } = validation.data;

    // In production, confirm the charge with the payment gateway before
    // marking the transaction complete.
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
       SET gateway_payment_id = $1, gateway_order_id = $2, status = 'completed'
       WHERE gateway_order_id = $2`,
      [paymentId, orderId],
    );

    await eventBus.sendPaymentEvent({
      type: 'payment.completed',
      payload: { userId, paymentId, orderId },
    });

    return reply.send({
      success: true,
      data: { verified: true, paymentId },
    });
  });

  // ─── Get Usage Limits ───────────────────────────────
  // Returns the user's current usage against free plan limits.
  app.get('/limits', async (request: FastifyRequest, reply: FastifyReply) => {
    const { sub: userId } = request.user as any;

    const subResult = await query(
      `SELECT tier FROM ${TABLES.SUBSCRIPTION_LEDGER} WHERE user_id = $1`,
      [userId],
    );
    const tier = subResult.rows[0]?.tier || 'free';
    const isPremium = tier !== 'free';

    // Active matches count
    const matchCountResult = await query(
      `SELECT COUNT(*)::int as cnt FROM ${TABLES.MATCHES}
       WHERE is_active = TRUE AND (user_a_id = $1 OR user_b_id = $1)`,
      [userId],
    );
    const activeChats = matchCountResult.rows[0]?.cnt ?? 0;

    // Lifetime right-swipe count from the durable interactions table
    const swipeCountResult = await query(
      `SELECT COUNT(*)::int AS cnt FROM ${TABLES.USER_INTERACTIONS}
       WHERE actor_id = $1 AND action IN ('like', 'super_like')`,
      [userId],
    );
    const swipesUsed = swipeCountResult.rows[0]?.cnt ?? 0;

    return reply.send({
      success: true,
      data: {
        tier,
        swipes: {
          used: swipesUsed,
          limit: isPremium ? PREMIUM_SWIPE_LIMIT : FREE_SWIPE_LIMIT,
        },
        chats: {
          used: activeChats,
          limit: isPremium ? PREMIUM_CHAT_LIMIT : FREE_CHAT_LIMIT,
        },
      },
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

  // ─── Create Subscription (Google Pay recurring) ───────
  // Creates a pending premium subscription in the user's local currency and
  // returns the Google Pay sheet configuration. The client then shows the
  // Google Pay payment sheet so the user can approve the recurring mandate
  // (UPI Autopay / tokenized card) and calls /subscription/activate with the
  // returned payment token.
  app.post('/subscription', async (request: FastifyRequest, reply: FastifyReply) => {
    const { sub: userId } = request.user as any;

    if (!isGooglePayConfigured()) {
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

      const subscriptionId = createSubscriptionId();

      // Remember the subscription on the ledger so /subscription/activate can
      // confirm it actually belongs to this user, and status shows 'pending'.
      await query(
        `INSERT INTO ${TABLES.SUBSCRIPTION_LEDGER} (user_id, gateway_subscription_id, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (user_id) DO UPDATE SET gateway_subscription_id = $2, updated_at = NOW()`,
        [userId, subscriptionId],
      );

      return reply.send({
        success: true,
        data: {
          subscriptionId,
          googlePay: getGooglePayClientConfig(),
          amount: pricing.amountMajor,
          amountMinor: pricing.amountMinor,
          currency: pricing.currency,
          label: pricing.label,
          period: PREMIUM_PLAN_PERIOD,
        },
      });
    } catch (error: any) {
      console.error('[payments] Failed to create subscription:', error?.message || error);
      return reply.status(502).send({
        success: false,
        error: {
          code: ERROR_CODES.PAYMENT_FAILED,
          message: 'Could not start the subscription. Please try again.',
        },
      });
    }
  });

  // ─── Activate Subscription ────────────────────────────
  // Called by the app after the Google Pay sheet returns. We confirm the
  // subscription belongs to this user, register the payment token with the
  // gateway as a recurring mandate (first charge included), then grant
  // premium. Renewals arrive on the payments webhook each month.
  app.post('/subscription/activate', async (request: FastifyRequest, reply: FastifyReply) => {
    const validation = ActivateSubscriptionSchema.safeParse(request.body);
    if (!validation.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'Invalid activation data',
          details: validation.error.flatten(),
        },
      });
    }

    const { sub: userId } = request.user as any;
    const { subscriptionId, paymentToken } = validation.data;

    // The subscription must be one we created for this user.
    const ledger = await getSubscription(userId);
    if (!ledger || ledger.gateway_subscription_id !== subscriptionId) {
      return reply.status(400).send({
        success: false,
        error: { code: ERROR_CODES.PAYMENT_FAILED, message: 'Subscription does not match this account' },
      });
    }

    // Price in the user's currency — the mandate is registered for this amount.
    const userResult = await query(`SELECT phone FROM ${TABLES.USERS} WHERE id = $1`, [userId]);
    const pricing = getPricingForPhone(userResult.rows[0]?.phone || '');

    let mandate: { status: string; paymentId: string };
    try {
      mandate = await registerAutopayMandate({
        subscriptionId,
        userId,
        paymentToken,
        amountMinor: pricing.amountMinor,
        currency: pricing.currency,
      });
    } catch (error: any) {
      console.error('[payments] Failed to register autopay mandate:', error?.message || error);
      return reply.status(502).send({
        success: false,
        error: {
          code: ERROR_CODES.PAYMENT_FAILED,
          message: 'Could not confirm the payment. Please try again.',
        },
      });
    }

    if (mandate.status !== 'active') {
      return reply.send({
        success: true,
        data: { verified: true, activated: false, status: mandate.status },
      });
    }

    const expiresAt = (() => { const d = new Date(); d.setMonth(d.getMonth() + 1); return d; })();

    // Grant premium entitlement
    await query(
      `INSERT INTO ${TABLES.SUBSCRIPTION_LEDGER}
         (user_id, tier, swipe_allowance, fast_passes_remaining, rain_checks_remaining,
          gateway_subscription_id, expires_at, auto_renew, updated_at)
       VALUES ($1, 'premium', $2, 5, 3, $3, $4, TRUE, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         tier = 'premium',
         swipe_allowance = $2,
         fast_passes_remaining = 5,
         rain_checks_remaining = 3,
         gateway_subscription_id = $3,
         expires_at = $4,
         auto_renew = TRUE,
         updated_at = NOW()`,
      [userId, PREMIUM_SWIPE_LIMIT, subscriptionId, expiresAt.toISOString()],
    );

    // Record the first transaction
    await query(
      `INSERT INTO ${TABLES.TRANSACTIONS}
         (user_id, gateway_payment_id, gateway_subscription_id, amount, currency, status, description)
       VALUES ($1, $2, $3, $4, $5, 'completed', $6)`,
      [userId, mandate.paymentId, subscriptionId, pricing.amountMajor, pricing.currency,
       `Kinetik Premium — ${pricing.label}`],
    );

    await eventBus.sendPaymentEvent({
      type: 'subscription.activated',
      payload: { userId, tier: 'premium', expiresAt, subscriptionId },
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

    if (!ledger || !ledger.gateway_subscription_id) {
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
        subscriptionId: ledger.gateway_subscription_id,
      },
    });
  });

  // ─── Subscription Billing History ─────────────────────
  // Recurring charges recorded for this user (first payment + webhook
  // renewals), newest first — powers the history list on the checkout screen.
  app.get('/subscription/history', async (request: FastifyRequest, reply: FastifyReply) => {
    const { sub: userId } = request.user as any;

    const result = await query(
      `SELECT gateway_payment_id, amount, currency, status, description, created_at
       FROM ${TABLES.TRANSACTIONS}
       WHERE user_id = $1 AND gateway_subscription_id IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 36`,
      [userId],
    );

    const payments = result.rows.map((row: any) => ({
      paymentId: row.gateway_payment_id,
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
  // Revokes the autopay mandate at the gateway and stops auto-renew. The user
  // keeps Premium until the date they already paid for; the payments webhook
  // (subscription.cancelled) flips the tier to free when the cycle ends.
  app.post('/subscription/cancel', async (request: FastifyRequest, reply: FastifyReply) => {
    const { sub: userId } = request.user as any;

    const ledger = await getSubscription(userId);
    const subscriptionId = ledger?.gateway_subscription_id;
    if (!ledger || !subscriptionId) {
      return reply.status(400).send({
        success: false,
        error: { code: ERROR_CODES.PAYMENT_FAILED, message: 'No active subscription to cancel' },
      });
    }

    try {
      const { status } = await revokeAutopayMandate(subscriptionId);

      // Keep premium until the end of the paid cycle; stop auto-renew
      await query(
        `UPDATE ${TABLES.SUBSCRIPTION_LEDGER}
         SET auto_renew = FALSE, updated_at = NOW()
         WHERE user_id = $1`,
        [userId],
      );

      const expiresAt = ledger.expires_at ? new Date(ledger.expires_at).toISOString() : null;

      await eventBus.sendPaymentEvent({
        type: 'subscription.cancelled',
        payload: { userId, subscriptionId, status },
      });

      return reply.send({
        success: true,
        data: { cancelled: true, status, subscriptionId, expiresAt },
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
