/**
 * Premium changes, forwarded to the app.
 *
 * api-core publishes a payment event whenever Play's answer changes a user's
 * ledger (services/subscriptionEntitlement.ts): 'subscription.activated' when
 * they are entitled, 'subscription.cancelled' when they drop to free (expiry,
 * refund, account hold). index.ts sends the result of this mapping to the
 * user's own room on the presence namespace, so every screen can catch up
 * without polling: a UPI mandate confirmed minutes later, a renewal, an end.
 */

export interface SubscriptionChangedPayload {
  premium: boolean;
  /** ISO time the current period ends, when Play reported one */
  expiresAt: string | null;
  /** Play's subscription state, e.g. SUBSCRIPTION_STATE_IN_GRACE_PERIOD */
  state: string | null;
}

/** The app-facing change for a payment event, or null for anything else. */
export function toSubscriptionChanged(
  event: any,
): { userId: string; payload: SubscriptionChangedPayload } | null {
  if (event?.type !== 'subscription.activated' && event?.type !== 'subscription.cancelled') {
    return null;
  }
  const userId = event.payload?.userId;
  if (typeof userId !== 'string' || !userId) return null;

  const expiresAt = event.payload?.expiresAt;
  const state = event.payload?.state;
  return {
    userId,
    payload: {
      premium: event.type === 'subscription.activated',
      expiresAt: typeof expiresAt === 'string' && expiresAt ? expiresAt : null,
      state: typeof state === 'string' && state ? state : null,
    },
  };
}
