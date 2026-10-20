import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { ERROR_CODES, FREE_SWIPE_LIMIT, FREE_CHAT_LIMIT, PREMIUM_SWIPE_LIMIT, PREMIUM_CHAT_LIMIT, getPricingForPhone } from '@kinetik/shared';
import { query, TABLES, getSubscription } from '../services/database';
import {
  isPlayBillingConfigured,
  getSubscriptionProductId,
  getManageSubscriptionUrl,
  getSubscriptionPurchase,
  acknowledgeSubscription,
  cancelSubscription,
  PREMIUM_PLAN_PERIOD,
} from '../services/playBilling';
import {
  applyPlayEntitlement,
  findUserByPurchaseToken,
  recordPendingPurchase,
} from '../services/subscriptionEntitlement';

const VerifyPurchaseSchema = z.object({
  // Opaque token from the Play purchase: Purchase.purchaseToken
  purchaseToken: z.string().min(1),
  productId: z.string().min(1).optional(),
  // Localized price the Play sheet showed, for the billing history row.
  priceAmount: z.number().nonnegative().optional(),
  priceCurrency: z.string().length(3).optional(),
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
        // Advisory only — Play charges its own regionally-set price, and the
        // app must display what the store reports, not this. Kept so the
        // paywall can show something before the store connection is ready.
        productId: getSubscriptionProductId(),
        period: PREMIUM_PLAN_PERIOD,
      },
    });
  });

  // ─── Verify a Play purchase ───────────────────────────
  // Called by the app right after the Play purchase sheet returns a token.
  // Google is the merchant of record, so nothing is charged here — we ask the
  // Play Developer API what the subscription's real state is, mirror it onto
  // the ledger, and acknowledge the purchase so Google doesn't refund it.
  //
  // This endpoint is idempotent: replaying the same token re-reads Play and
  // converges on the same ledger state.
  app.post('/subscription/verify', async (request: FastifyRequest, reply: FastifyReply) => {
    const validation = VerifyPurchaseSchema.safeParse(request.body);
    if (!validation.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'Invalid purchase data',
          details: validation.error.flatten(),
        },
      });
    }

    if (!isPlayBillingConfigured()) {
      return reply.status(503).send({
        success: false,
        error: {
          code: ERROR_CODES.PAYMENT_FAILED,
          message: 'Payments are not configured on the server yet. Please try again later.',
        },
      });
    }

    const { sub: userId } = request.user as any;
    const { purchaseToken, productId, priceAmount, priceCurrency } = validation.data;

    // Only the plan we actually sell is accepted.
    const expectedProduct = getSubscriptionProductId();
    if (productId && productId !== expectedProduct) {
      return reply.status(400).send({
        success: false,
        error: { code: ERROR_CODES.PAYMENT_FAILED, message: 'Unknown subscription product' },
      });
    }

    // A purchase token belongs to exactly one account. Without this check a
    // token could be replayed to grant Premium on a second account.
    const owner = await findUserByPurchaseToken(purchaseToken);
    if (owner && owner !== userId) {
      return reply.status(409).send({
        success: false,
        error: {
          code: ERROR_CODES.PAYMENT_FAILED,
          message: 'This purchase is already linked to another Kinetik account.',
        },
      });
    }

    let playSub;
    try {
      playSub = await getSubscriptionPurchase(purchaseToken);
    } catch (error: any) {
      console.error('[payments] Play verification failed:', error?.message || error);
      return reply.status(502).send({
        success: false,
        error: {
          code: ERROR_CODES.PAYMENT_FAILED,
          message: 'Could not confirm the purchase with Google Play. Please try again.',
        },
      });
    }

    // UPI Autopay mandates are not always confirmed when the sheet closes.
    // Granting Premium here would hand out a free month if the mandate then
    // fails — wait for the RTDN that resolves it.
    //
    // That notification carries only the purchase token, so the token has to
    // be bound to this account NOW or the webhook cannot tell whose purchase
    // completed and Premium would only ever arrive if the user happened to
    // reopen the checkout screen before Google's three-day refund.
    if (playSub.state === 'SUBSCRIPTION_STATE_PENDING') {
      await recordPendingPurchase(userId, purchaseToken, playSub.productId ?? productId ?? null);
      return reply.send({
        success: true,
        data: { verified: true, activated: false, pending: true, state: playSub.state },
      });
    }

    await applyPlayEntitlement(
      userId,
      purchaseToken,
      playSub,
      priceAmount != null && priceCurrency
        ? { amount: priceAmount, currency: priceCurrency }
        : undefined,
    );

    // Acknowledge only after the entitlement is durably granted. Google
    // auto-refunds and revokes anything unacknowledged after three days.
    // A failure here is logged, not surfaced: the user has their subscription,
    // and the RTDN for this purchase or the hourly sweep
    // (services/subscriptionSweep.ts) acknowledges it within the three days.
    if (playSub.entitled && playSub.needsAcknowledgement) {
      try {
        await acknowledgeSubscription(purchaseToken);
      } catch (error: any) {
        console.error('[payments] Play acknowledgement failed:', error?.message || error);
      }
    }

    return reply.send({
      success: true,
      data: {
        verified: true,
        activated: playSub.entitled,
        pending: false,
        tier: playSub.entitled ? 'premium' : 'free',
        expiresAt: playSub.expiresAt ? playSub.expiresAt.toISOString() : null,
        state: playSub.state,
      },
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
        data: {
          tier: 'free',
          autoRenew: false,
          expiresAt: null,
          hasPurchase: false,
          manageUrl: getManageSubscriptionUrl(),
        },
      });
    }

    return reply.send({
      success: true,
      data: {
        tier: ledger.tier,
        autoRenew: Boolean(ledger.auto_renew),
        expiresAt: ledger.expires_at ? new Date(ledger.expires_at).toISOString() : null,
        // The purchase token itself is deliberately NOT returned — the app has
        // no use for it and it is the credential Play verification turns on.
        hasPurchase: true,
        manageUrl: getManageSubscriptionUrl(),
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
  // Stops the subscription renewing at Play. The user keeps Premium until the
  // end of the period they already paid for — this is not a refund.
  //
  // USER_REQUESTED_STOP_RENEWALS keeps it restorable, so the user can turn
  // renewal back on from Play without buying again.
  //
  // The ledger is NOT written here. Play is the source of truth, and the
  // SUBSCRIPTION_CANCELED notification that follows updates it — writing both
  // would risk the two disagreeing if the cancel succeeded but the write
  // failed. The response re-reads Play so the app can update immediately.
  app.post('/subscription/cancel', async (request: FastifyRequest, reply: FastifyReply) => {
    const { sub: userId } = request.user as any;

    const ledger = await getSubscription(userId);
    const purchaseToken = ledger?.gateway_subscription_id;
    if (!ledger || !purchaseToken) {
      return reply.status(400).send({
        success: false,
        error: { code: ERROR_CODES.PAYMENT_FAILED, message: 'No active subscription to cancel' },
      });
    }

    try {
      await cancelSubscription(purchaseToken, 'USER_REQUESTED_STOP_RENEWALS');
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

    // Best-effort refresh so the screen shows the new state without waiting
    // for the notification to arrive.
    let expiresAt = ledger.expires_at ? new Date(ledger.expires_at).toISOString() : null;
    try {
      const playSub = await getSubscriptionPurchase(purchaseToken);
      await applyPlayEntitlement(userId, purchaseToken, playSub);
      expiresAt = playSub.expiresAt ? playSub.expiresAt.toISOString() : expiresAt;
    } catch (error: any) {
      console.warn('[payments] Cancelled, but could not refresh state:', error?.message || error);
    }

    return reply.send({
      success: true,
      data: { cancelled: true, expiresAt, manageUrl: getManageSubscriptionUrl() },
    });
  });
}
