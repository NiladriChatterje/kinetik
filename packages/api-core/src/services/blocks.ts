import { query, TABLES } from './database';

/**
 * True when either person has reported the other (routes/safety.ts). A chat
 * between a reported pair is kept for review instead of being deleted, by
 * unmatch and by account deletion alike; the moderation tool purges it once
 * the reports are resolved and the legal retention period has passed.
 */
export async function isReportedPair(userId: string, otherUserId: string): Promise<boolean> {
  const result = await query(
    `SELECT 1 FROM ${TABLES.USER_REPORTS}
     WHERE (reporter_id = $1 AND reported_id = $2) OR (reporter_id = $2 AND reported_id = $1)
     LIMIT 1`,
    [userId, otherUserId],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Blocks between members (routes/safety.ts creates them).
 *
 * A block is stored one way (blocker → blocked) but acts both ways: neither
 * person can see, like or like back the other. The profile feeds exclude
 * blocked pairs in SQL; the like paths ask this function.
 */
export async function isBlockedPair(userId: string, otherUserId: string): Promise<boolean> {
  const result = await query(
    `SELECT 1 FROM ${TABLES.USER_BLOCKS}
     WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)
     LIMIT 1`,
    [userId, otherUserId],
  );
  return (result.rowCount ?? 0) > 0;
}
