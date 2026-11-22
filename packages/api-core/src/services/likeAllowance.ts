import { FREE_SWIPE_LIMIT, PREMIUM_DAILY_LIKE_LIMIT, LIKE_DAY_TIME_ZONE } from '@kinetik/shared';
import { query, TABLES } from './database';

/**
 * How many likes (right swipes) a user may send, by plan:
 * - Free: FREE_SWIPE_LIMIT for the account's whole life, never reset.
 * - Premium: PREMIUM_DAILY_LIKE_LIMIT per day, the day starting at midnight
 *   in LIKE_DAY_TIME_ZONE. There is no lifetime total for Premium.
 * Passing left is never limited.
 *
 * Counts come from the durable user_interactions table, so a Redis restart
 * cannot reset them. A pass or a rejected like that is later turned into a
 * like is rewritten with created_at = NOW(), so it counts on the day it is sent.
 */
export interface LikeAllowance {
  /** Likes already counted against the limit (today's for Premium, all-time for free) */
  used: number;
  limit: number;
  /** 'day' for Premium (resets at midnight), 'lifetime' for free */
  period: 'day' | 'lifetime';
}

export interface LikeCounts {
  lifetime: number;
  /** Since the last midnight in LIKE_DAY_TIME_ZONE */
  today: number;
}

/** Both counts in one round trip; the actor index keeps this cheap. */
export async function countLikes(userId: string): Promise<LikeCounts> {
  const result = await query(
    `SELECT COUNT(*)::int AS lifetime,
            COUNT(*) FILTER (
              WHERE created_at >= (date_trunc('day', NOW() AT TIME ZONE $2::text) AT TIME ZONE $2::text)
            )::int AS today
       FROM ${TABLES.USER_INTERACTIONS}
      WHERE actor_id = $1 AND action IN ('like', 'super_like')`,
    [userId, LIKE_DAY_TIME_ZONE],
  );
  const row = result.rows[0];
  return { lifetime: row?.lifetime ?? 0, today: row?.today ?? 0 };
}

/** The limit that applies to this user and how much of it is used. */
export function likeAllowance(premium: boolean, counts: LikeCounts): LikeAllowance {
  return premium
    ? { used: counts.today, limit: PREMIUM_DAILY_LIKE_LIMIT, period: 'day' }
    : { used: counts.lifetime, limit: FREE_SWIPE_LIMIT, period: 'lifetime' };
}
