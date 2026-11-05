/**
 * Has a date plan's day passed?
 *
 * Plan dates are the planner's local calendar day ('YYYY-MM-DD') and the
 * server runs on UTC, so it cannot know the exact local day. A day before
 * yesterday (UTC) is over in every timezone, so that is the server's line;
 * the app drops a plan on the exact local day itself. A missing or
 * malformed date is not over (a plan with only ideas, no day yet).
 */
export function isPlanDayOver(date: unknown, now: Date = new Date()): boolean {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const yesterday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  return date < yesterday.toISOString().slice(0, 10);
}
