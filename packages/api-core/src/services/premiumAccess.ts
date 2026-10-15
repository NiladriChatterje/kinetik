import { REDIS_KEYS } from '@kinetik/shared';
import { query, TABLES } from './database';
import { getRedis } from './redis';

/**
 * Server-side Premium gates for the two paid features:
 *
 *  - Who liked you: free users get only a count, never the likers.
 *  - Chat: a free user can chat in ONE conversation, their first match.
 *    Every other match is locked (no reading, sending, media or live events)
 *    until they subscribe. Once that first match is unmatched the free chat is
 *    spent: the next match does not take its place, or a free user could
 *    chat with everyone one at a time by unmatching between them.
 *
 * Every endpoint that exposes those features checks here, so the app hiding
 * a screen is never the only guard. The realtime service applies the same
 * rule when a socket joins a chat room (realtime/src/handlers/chat.ts).
 */

/** Error code the app recognises to show the Premium upsell on a locked chat. */
export const CHAT_LOCKED = 'CHAT_LOCKED';

/**
 * Premium = a paid tier whose Play expiry has not passed. The expiry check
 * means a missed "subscription ended" notification cannot leave a user on
 * Premium for good. The few hours of grace cover a renewal notification that
 * arrives after the old period's expiry.
 */
export async function hasActivePremium(userId: string): Promise<boolean> {
  const key = REDIS_KEYS.USER_PREMIUM(userId);
  const cached = await withPremiumCache((redis) => redis.get(key));
  if (cached === '1') return true;
  if (cached === '0') return false;

  const premium = await queryActivePremium(userId);
  // Written in the background: the answer is already known, and a slow
  // cache must not slow the request.
  void withPremiumCache((redis) => redis.set(key, premium ? '1' : '0', 'EX', PREMIUM_CACHE_TTL_SECONDS));
  return premium;
}

/**
 * Drop the cached Premium answer. Called wherever the ledger's tier changes,
 * so a purchase or an expiry shows the moment it is recorded rather than up
 * to PREMIUM_CACHE_TTL_SECONDS later.
 */
export async function invalidatePremiumCache(userId: string): Promise<void> {
  await withPremiumCache((redis) => redis.del(REDIS_KEYS.USER_PREMIUM(userId)));
}

/** How long a Premium answer is reused before the ledger is asked again. */
const PREMIUM_CACHE_TTL_SECONDS = 60;
/** A cache slower than this is treated as absent and the ledger is asked. */
const PREMIUM_CACHE_TIMEOUT_MS = 300;

/**
 * Run one cache command, or return null when the cache cannot answer:
 * Redis not configured, not connected, erroring, or slow. The ledger is
 * always the fallback, so a cache problem can only cost a query, never a
 * wrong answer or a failed request.
 */
async function withPremiumCache<T>(op: (redis: ReturnType<typeof getRedis>) => Promise<T>): Promise<T | null> {
  if (!process.env.REDIS_AIVEN_URL) return null;
  let redis: ReturnType<typeof getRedis>;
  try {
    redis = getRedis();
  } catch {
    return null;
  }
  // ioredis queues commands while reconnecting; they would wait, not fail.
  if (!redis || (redis as any).status !== 'ready') return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      op(redis),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), PREMIUM_CACHE_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function queryActivePremium(userId: string): Promise<boolean> {
  const result = await query(
    `SELECT 1 FROM ${TABLES.SUBSCRIPTION_LEDGER}
     WHERE user_id = $1
       AND tier IN ('premium', 'infinite')
       AND expires_at IS NOT NULL
       AND expires_at > NOW() - INTERVAL '6 hours'`,
    [userId],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * The one conversation a free user may use: their first match, active or
 * not. Null when they have no match yet, or when that first match has been
 * unmatched — then every chat is locked.
 */
export async function freeChatMatchId(userId: string): Promise<string | null> {
  const key = REDIS_KEYS.USER_FREE_CHAT(userId);
  const cached = await withPremiumCache((redis) => redis.get(key));
  if (cached) return cached;

  const result = await query(
    `SELECT id, is_active FROM ${TABLES.MATCHES}
     WHERE user_a_id = $1 OR user_b_id = $1
     ORDER BY matched_at ASC, id ASC
     LIMIT 1`,
    [userId],
  );
  const first = result.rows[0];
  const freeId: string | null = first?.is_active ? first.id : null;
  // Only a found id is cached. A cached "none" could outlive a match created
  // moments later and lock that chat for the cache's lifetime; a cached id
  // that has since been unmatched is harmless, because every chat route also
  // requires the match row to be active. Written in the background.
  if (freeId) {
    void withPremiumCache((redis) => redis.set(key, freeId, 'EX', PREMIUM_CACHE_TTL_SECONDS));
  }
  return freeId;
}

/**
 * Drop the cached free-chat id for a user. Called when one of their matches
 * is created or unmatched, which are the only events that change the answer.
 */
export async function invalidateFreeChatCache(userId: string): Promise<void> {
  await withPremiumCache((redis) => redis.del(REDIS_KEYS.USER_FREE_CHAT(userId)));
}

/**
 * Which of the user's chats are locked. `isLocked(matchId)` is true for every
 * chat except the free one, unless the user has Premium.
 */
export async function getChatAccess(
  userId: string,
): Promise<{ premium: boolean; isLocked: (matchId: string) => boolean }> {
  if (await hasActivePremium(userId)) {
    return { premium: true, isLocked: () => false };
  }
  const freeId = await freeChatMatchId(userId);
  return { premium: false, isLocked: (matchId) => matchId !== freeId };
}

export async function isChatLocked(userId: string, matchId: string): Promise<boolean> {
  return (await getChatAccess(userId)).isLocked(matchId);
}
