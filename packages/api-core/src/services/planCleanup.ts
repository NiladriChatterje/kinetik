import { getDatabasePool } from '@kinetik/shared';
import { query, TABLES } from './database';

// Daily cleanup of date plans whose day is over.
//
// Reads already hide such a plan (isPlanDayOver in planDay.ts, and the app
// on the exact local day); this empties the stored plan so old activities
// and notes do not stay in the database. One statement for every chat at
// once, using the server's clock, never a phone's. The fixed date itself
// (matches.date_scheduled) is kept: the profile counts dates planned.
//
// Same line as isPlanDayOver: a day before yesterday (UTC) is over in every
// timezone. A plan without a day (only ideas so far) is left alone.
//
// It never wakes the database: it runs only while the database is already
// in use (a connection taken in the last two minutes), at most once a day.
// A failed run is tried again an hour later, at the next moment the
// database is in use. One api-core instance runs it; a second would only
// repeat the same idempotent update.

export const PLAN_CLEANUP_EVERY_MS = 24 * 60 * 60 * 1000;
export const PLAN_CLEANUP_RETRY_MS = 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 5 * 60 * 1000;
const AWAKE_WITHIN_MS = 2 * 60 * 1000;
const CHECK_EVERY_MS = 60 * 1000;

export const PLAN_CLEANUP_SQL = `
  UPDATE ${TABLES.MATCHES}
     SET planner_data = NULL
   WHERE planner_data IS NOT NULL
     AND planner_data->>'date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     AND planner_data->>'date' < to_char((NOW() AT TIME ZONE 'UTC')::date - 1, 'YYYY-MM-DD')`;

/** Empties every plan whose day is over; returns how many were emptied. */
export async function cleanUpPastPlans(): Promise<number> {
  const result = await query(PLAN_CLEANUP_SQL);
  return result.rowCount ?? 0;
}

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

/** Start the daily cleanup (schedule above). */
export function startPlanCleanup(): void {
  if (timer) return;

  let nextRunAt = Date.now() + FIRST_RUN_DELAY_MS;
  let lastQueryAt = 0;
  getDatabasePool().on('acquire', () => {
    lastQueryAt = Date.now();
  });

  const run = async () => {
    if (running) return;
    running = true;
    try {
      const emptied = await cleanUpPastPlans();
      if (emptied) console.log(`[plan-cleanup] emptied ${emptied} past date plan(s)`);
      nextRunAt = Date.now() + PLAN_CLEANUP_EVERY_MS;
    } catch (error: any) {
      console.error('[plan-cleanup] Run failed:', error?.message || error);
      nextRunAt = Date.now() + PLAN_CLEANUP_RETRY_MS;
    } finally {
      running = false;
    }
  };

  timer = setInterval(() => {
    const awake = Date.now() - lastQueryAt < AWAKE_WITHIN_MS;
    if (awake && Date.now() >= nextRunAt) run();
  }, CHECK_EVERY_MS);
  timer.unref();
}
