import { query, TABLES } from './database';

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
  const result = await query(
    `SELECT id, is_active FROM ${TABLES.MATCHES}
     WHERE user_a_id = $1 OR user_b_id = $1
     ORDER BY matched_at ASC, id ASC
     LIMIT 1`,
    [userId],
  );
  const first = result.rows[0];
  return first?.is_active ? first.id : null;
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
