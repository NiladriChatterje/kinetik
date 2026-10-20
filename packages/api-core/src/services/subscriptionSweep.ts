import { query, TABLES } from './database';
import { acknowledgeSubscription, getSubscriptionPurchase, isPlayBillingConfigured } from './playBilling';
import { applyPlayEntitlement } from './subscriptionEntitlement';

// Fallback for Play's Real-time Developer Notifications (RTDN).
//
// RTDN is how Play tells us a subscription renewed, was cancelled, expired or
// went on hold. Without it (the Pub/Sub topic not set up, or a notification
// lost) the ledger keeps the old expiry, and premiumAccess.ts stops granting
// Premium six hours later, although Google has already charged the renewal.
//
// Once an hour this re-reads from Play every Play-billed subscription whose
// recorded period has ended or is about to, and applies the answer through
// applyPlayEntitlement, the same path the webhook takes: a renewal moves the
// expiry forward, an expiry, refund or account hold drops the user to free.
// Either way the row leaves the sweep until its next period ends. A Play or
// database error leaves the row as it was, to be retried on the next run.
//
// It also re-reads purchases from the last three days and acknowledges any
// still unacknowledged. Google refunds and revokes those after three days,
// and the verify endpoint's own acknowledgement can fail.
//
// Hourly, not more often: the free-tier database sleeps when idle and each
// run wakes it, and six hours of grace leave plenty of room.
//
// One api-core instance runs it. A second instance would only repeat the same
// idempotent reads and writes.

export const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 2 * 60 * 1000;
const BATCH_LIMIT = 200;

/**
 * Play-billed Premium rows that need a look. `due` marks a period that has
 * ended or ends within the hour; the others are recent purchases, checked
 * for a missing acknowledgement only. Manually granted Premium (no token)
 * and legacy tiers are never touched.
 */
export const SWEEP_SQL = `
  SELECT user_id,
         gateway_subscription_id AS purchase_token,
         (expires_at IS NULL OR expires_at < NOW() + INTERVAL '1 hour') AS due
    FROM ${TABLES.SUBSCRIPTION_LEDGER}
   WHERE tier = 'premium'
     AND gateway_subscription_id IS NOT NULL
     AND (expires_at IS NULL
          OR expires_at < NOW() + INTERVAL '1 hour'
          OR updated_at > NOW() - INTERVAL '3 days')
   ORDER BY expires_at ASC NULLS FIRST
   LIMIT ${BATCH_LIMIT}`;

export interface SweepResult {
  checked: number;
  renewed: number;
  ended: number;
  acknowledged: number;
  failed: number;
}

export async function sweepSubscriptions(): Promise<SweepResult> {
  const result: SweepResult = { checked: 0, renewed: 0, ended: 0, acknowledged: 0, failed: 0 };
  const rows = (await query(SWEEP_SQL)).rows as { user_id: string; purchase_token: string; due: boolean }[];

  for (const row of rows) {
    result.checked++;
    try {
      const playSub = await getSubscriptionPurchase(row.purchase_token);

      if (row.due) {
        await applyPlayEntitlement(row.user_id, row.purchase_token, playSub);
        if (playSub.entitled) result.renewed++;
        else result.ended++;
      }

      // Acknowledge only once the entitlement is on the ledger: a due row was
      // just applied, and a recent purchase got there through verify.
      if (playSub.entitled && playSub.needsAcknowledgement) {
        await acknowledgeSubscription(row.purchase_token);
        result.acknowledged++;
      }
    } catch (error: any) {
      result.failed++;
      console.error(`[subscription-sweep] Could not refresh user ${row.user_id}:`, error?.message || error);
    }
  }

  return result;
}

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

/** Start the hourly sweep. Does nothing when Play billing is not configured. */
export function startSubscriptionSweep(): void {
  if (timer) return;
  if (!isPlayBillingConfigured()) {
    console.log('[subscription-sweep] Play billing not configured; renewal sweep is off');
    return;
  }

  const run = async () => {
    if (running) return;
    running = true;
    try {
      const r = await sweepSubscriptions();
      if (r.checked) {
        console.log(
          `[subscription-sweep] checked ${r.checked}: ${r.renewed} still active, ${r.ended} ended, ` +
            `${r.acknowledged} acknowledged, ${r.failed} failed`,
        );
      }
    } catch (error: any) {
      // The database may be waking up; the next run tries again
      console.error('[subscription-sweep] Run failed:', error?.message || error);
    } finally {
      running = false;
    }
  };

  setTimeout(run, FIRST_RUN_DELAY_MS).unref();
  timer = setInterval(run, SWEEP_INTERVAL_MS);
  timer.unref();
}
