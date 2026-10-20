import { FREE_SWIPE_LIMIT, PREMIUM_SWIPE_LIMIT } from '@kinetik/shared';
import { invalidatePremiumCache } from './premiumAccess';
import { query, TABLES } from './database';
import { eventBus } from './eventBus';
import { getRedis } from './redis';
import type { PlaySubscription } from './playBilling';

// Applying what Google Play reports onto our own ledger.
//
// Play is the single source of truth for whether a subscription is live. Both
// the purchase-verify endpoint and the RTDN webhook end up here so that a
// renewal, a cancellation, a refund and a first purchase all converge on one
// piece of logic instead of drifting apart.

/**
 * Finds the user a purchase token belongs to. RTDN carries nothing else.
 *
 * The ledger holds the token of the subscription that currently backs the
 * user's tier. A purchase still waiting on a UPI mandate is not on the ledger
 * yet — it lives in play_pending_purchases until Play reports a final state —
 * so both are consulted.
 */
export async function findUserByPurchaseToken(purchaseToken: string): Promise<string | null> {
  const ledger = await query(
    `SELECT user_id FROM ${TABLES.SUBSCRIPTION_LEDGER} WHERE gateway_subscription_id = $1`,
    [purchaseToken],
  );
  if (ledger.rows[0]?.user_id) return ledger.rows[0].user_id;

  const pending = await query(
    `SELECT user_id FROM ${TABLES.PLAY_PENDING_PURCHASES} WHERE purchase_token = $1`,
    [purchaseToken],
  );
  return pending.rows[0]?.user_id ?? null;
}

/**
 * Binds a purchase that Play reports as SUBSCRIPTION_STATE_PENDING to the
 * account that started it. Nothing is granted; this only makes sure the
 * notification that arrives when the bank confirms (or rejects) the mandate
 * can be traced back to a user and acted on.
 *
 * The caller has already established that no other account owns the token,
 * so a conflicting row can only be this user's own earlier attempt. The WHERE
 * on the upsert makes that assumption enforceable rather than assumed.
 */
export async function recordPendingPurchase(
  userId: string,
  purchaseToken: string,
  productId: string | null,
): Promise<void> {
  await query(
    `INSERT INTO ${TABLES.PLAY_PENDING_PURCHASES} (purchase_token, user_id, product_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (purchase_token) DO UPDATE SET
       product_id = COALESCE(EXCLUDED.product_id, ${TABLES.PLAY_PENDING_PURCHASES}.product_id),
       updated_at = NOW()
     WHERE ${TABLES.PLAY_PENDING_PURCHASES}.user_id = EXCLUDED.user_id`,
    [purchaseToken, userId, productId],
  );
}

/**
 * Writes Play's view of a subscription onto the ledger and records the charge.
 *
 * Entitled  → premium, expiry and auto-renew mirrored from Play.
 * Not entitled → back to free, but only when this token is the one backing the
 * ledger row. A different token that Play reports as expired, cancelled or
 * still pending says nothing about the subscription the user actually holds —
 * a pending mandate that the bank later rejected must not knock out an active
 * subscription bought another way.
 *
 * This is what handles expiry, refunds, revocation and account hold; no
 * separate cancellation bookkeeping is needed because Play already told us the
 * resulting state.
 */
export async function applyPlayEntitlement(
  userId: string,
  purchaseToken: string,
  sub: PlaySubscription,
  /**
   * Localized price the Play sheet showed, passed through from the app on the
   * first purchase. subscriptionsv2 does not report the amount charged, so
   * renewals arriving over RTDN record the charge without one — the billing
   * history renders those as "—" and Play Console holds the real figures.
   */
  priceHint?: { amount: number; currency: string },
): Promise<void> {
  let ledgerChanged = true;

  if (sub.entitled) {
    await query(
      `INSERT INTO ${TABLES.SUBSCRIPTION_LEDGER}
         (user_id, tier, swipe_allowance, fast_passes_remaining, rain_checks_remaining,
          gateway_subscription_id, expires_at, auto_renew, updated_at, play_state)
       VALUES ($1, 'premium', $2, 5, 3, $3, $4, $5, NOW(), $6)
       ON CONFLICT (user_id) DO UPDATE SET
         tier = 'premium',
         swipe_allowance = $2,
         fast_passes_remaining = 5,
         rain_checks_remaining = 3,
         gateway_subscription_id = $3,
         expires_at = $4,
         auto_renew = $5,
         updated_at = NOW(),
         play_state = $6`,
      [userId, PREMIUM_SWIPE_LIMIT, purchaseToken, sub.expiresAt, sub.autoRenewing, sub.state],
    );
  } else {
    // Keep the token on the row: Play may later report the same subscription
    // as recovered from account hold, and the token is how we find this user.
    const result = await query(
      `UPDATE ${TABLES.SUBSCRIPTION_LEDGER}
          SET tier = 'free',
              swipe_allowance = $2,
              auto_renew = FALSE,
              expires_at = $3,
              updated_at = NOW(),
              play_state = $5
        WHERE user_id = $1
          AND gateway_subscription_id = $4`,
      [userId, FREE_SWIPE_LIMIT, sub.expiresAt, purchaseToken, sub.state],
    );
    ledgerChanged = (result.rowCount ?? 0) > 0;
  }

  // One row per Play order id. The unique partial index added in migration 020
  // makes redelivered notifications a no-op rather than a duplicate charge.
  if (sub.orderId && sub.entitled) {
    await query(
      `INSERT INTO ${TABLES.TRANSACTIONS}
         (user_id, gateway_payment_id, gateway_subscription_id, amount, currency, status, description)
       VALUES ($1, $2, $3, $4, $5, 'completed', $6)
       ON CONFLICT (gateway_payment_id) WHERE gateway_payment_id IS NOT NULL DO NOTHING`,
      [
        userId,
        sub.orderId,
        purchaseToken,
        priceHint?.amount ?? null,
        priceHint?.currency ?? null,
        sub.isTestPurchase ? 'Kinetik Premium — test purchase' : 'Kinetik Premium — weekly',
      ],
    );
  }

  // Play has settled this purchase one way or the other, so it is no longer
  // pending. An entitled purchase is now on the ledger, which is where the
  // webhook will find it from here on. A purchase Play still reports as
  // PENDING keeps its row — the mandate is simply not resolved yet.
  if (sub.state !== 'SUBSCRIPTION_STATE_PENDING') {
    await query(`DELETE FROM ${TABLES.PLAY_PENDING_PURCHASES} WHERE purchase_token = $1`, [
      purchaseToken,
    ]);
  }

  if (!ledgerChanged) {
    // Nothing about the user's tier moved, so there is no cache to drop and no
    // "subscription cancelled" event to send — sending one would tell the app
    // a subscription it still holds had ended.
    return;
  }

  // The swipe allowance is cached; drop it so the new tier applies immediately.
  try {
    await getRedis().del(`user:${userId}:swipes:daily`);
  } catch (error: any) {
    console.warn('[entitlement] Could not clear swipe cache:', error?.message || error);
  }
  // Same for the Premium answer the gates cache (never throws).
  await invalidatePremiumCache(userId);

  await eventBus.sendPaymentEvent({
    type: sub.entitled ? 'subscription.activated' : 'subscription.cancelled',
    payload: {
      userId,
      tier: sub.entitled ? 'premium' : 'free',
      expiresAt: sub.expiresAt,
      state: sub.state,
    },
  });
}
