import { FREE_SWIPE_LIMIT, PREMIUM_SWIPE_LIMIT } from '@kinetik/shared';
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

/** Finds the user a purchase token belongs to. RTDN carries nothing else. */
export async function findUserByPurchaseToken(purchaseToken: string): Promise<string | null> {
  const result = await query(
    `SELECT user_id FROM ${TABLES.SUBSCRIPTION_LEDGER} WHERE gateway_subscription_id = $1`,
    [purchaseToken],
  );
  return result.rows[0]?.user_id ?? null;
}

/**
 * Writes Play's view of a subscription onto the ledger and records the charge.
 *
 * Entitled  → premium, expiry and auto-renew mirrored from Play.
 * Not entitled → back to free. This is what handles expiry, refunds, revocation
 * and account hold; no separate cancellation bookkeeping is needed because
 * Play already told us the resulting state.
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
  if (sub.entitled) {
    await query(
      `INSERT INTO ${TABLES.SUBSCRIPTION_LEDGER}
         (user_id, tier, swipe_allowance, fast_passes_remaining, rain_checks_remaining,
          gateway_subscription_id, expires_at, auto_renew, updated_at)
       VALUES ($1, 'premium', $2, 5, 3, $3, $4, $5, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         tier = 'premium',
         swipe_allowance = $2,
         fast_passes_remaining = 5,
         rain_checks_remaining = 3,
         gateway_subscription_id = $3,
         expires_at = $4,
         auto_renew = $5,
         updated_at = NOW()`,
      [userId, PREMIUM_SWIPE_LIMIT, purchaseToken, sub.expiresAt, sub.autoRenewing],
    );
  } else {
    // Keep the token on the row: Play may later report the same subscription
    // as recovered from account hold, and the token is how we find this user.
    await query(
      `UPDATE ${TABLES.SUBSCRIPTION_LEDGER}
          SET tier = 'free',
              swipe_allowance = $2,
              auto_renew = FALSE,
              expires_at = $3,
              updated_at = NOW()
        WHERE user_id = $1`,
      [userId, FREE_SWIPE_LIMIT, sub.expiresAt],
    );
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
        sub.isTestPurchase ? 'Kinetik Premium — test purchase' : 'Kinetik Premium — monthly',
      ],
    );
  }

  // The swipe allowance is cached; drop it so the new tier applies immediately.
  try {
    await getRedis().del(`user:${userId}:swipes:daily`);
  } catch (error: any) {
    console.warn('[entitlement] Could not clear swipe cache:', error?.message || error);
  }

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
