import { Expo, ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';
import { query, TABLES } from './database';

// Create a new Expo SDK client
// Optionally pass accessToken if you use Expo's notification service with authentication
let expo: Expo | null = null;

function getExpoClient(): Expo {
  if (!expo) {
    expo = new Expo({
      accessToken: process.env.EXPO_ACCESS_TOKEN,
    });
  }
  return expo;
}

// ─── Token Management ─────────────────────────────────────

export async function registerPushToken(
  userId: string,
  token: string,
  platform: 'ios' | 'android' | 'web',
): Promise<void> {
  // Validate the token format
  const tokenPreview = typeof token === 'string' && token.length > 20 ? token.slice(0, 20) + '...' : token;
  if (!Expo.isExpoPushToken(token)) {
    console.warn(`[notifications] Invalid Expo push token for user ${userId}: ${tokenPreview}`);
    return;
  }

  // The token is the device. If another account registered it earlier (a
  // shared or re-sold phone), that account must not keep receiving this
  // device's pushes.
  await query(
    `UPDATE ${TABLES.PUSH_TOKENS} SET is_active = FALSE, updated_at = NOW()
     WHERE token = $1 AND user_id <> $2 AND is_active = TRUE`,
    [token, userId],
  );

  // Upsert: insert if not exists, or reactivate if soft-deleted
  await query(
    `INSERT INTO ${TABLES.PUSH_TOKENS} (user_id, token, platform, is_active)
     VALUES ($1, $2, $3, TRUE)
     ON CONFLICT (user_id, token) DO UPDATE SET
       is_active = TRUE,
       platform = EXCLUDED.platform,
       updated_at = NOW()`,
    [userId, token, platform],
  );

  console.log(`[notifications] Registered push token for user ${userId} (${platform})`);
}

export async function unregisterPushToken(userId: string, token: string): Promise<void> {
  await query(
    `UPDATE ${TABLES.PUSH_TOKENS} SET is_active = FALSE, updated_at = NOW()
     WHERE user_id = $1 AND token = $2`,
    [userId, token],
  );
}

export async function getUserPushTokens(userId: string): Promise<string[]> {
  const result = await query<{ token: string }>(
    `SELECT token FROM ${TABLES.PUSH_TOKENS}
     WHERE user_id = $1 AND is_active = TRUE`,
    [userId],
  );
  return result.rows.map((r: { token: string }) => r.token);
}

// ─── Sending Notifications ────────────────────────────────

export interface NotificationPayload {
  title?: string;
  body: string;
  data?: Record<string, unknown>;
  priority?: 'default' | 'normal' | 'high';
  sound?: 'default' | null;
  badge?: number;
  /** Android notification channel the app created ('default' or 'messages') */
  channelId?: string;
  /**
   * Pushes of one kind share one tray entry: a new push with the same group
   * replaces the one already showing instead of stacking under it (Android
   * notification tag, iOS collapse id). Each push carries the current count,
   * so the entry left in the tray is always the up-to-date one.
   */
  group?: PushGroup;
}

/** One tray entry per kind of activity */
export const PUSH_GROUPS = {
  messages: 'kinetik.messages',
  likes: 'kinetik.likes',
  matches: 'kinetik.matches',
} as const;
export type PushGroup = (typeof PUSH_GROUPS)[keyof typeof PUSH_GROUPS];

/**
 * Send a push notification to a single user.
 * Respects the user's notification preferences.
 */
export async function sendPushNotification(
  userId: string,
  _notificationType: string,
  payload: NotificationPayload,
): Promise<void> {
  try {
    // Check if user has push notifications enabled
    const prefsResult = await query<{ push_enabled: boolean }>(
      `SELECT push_enabled FROM ${TABLES.USER_PREFERENCES} WHERE user_id = $1`,
      [userId],
    );

    // If no preferences row, default to enabled
    const pushEnabled = prefsResult.rows[0]?.push_enabled ?? true;
    if (!pushEnabled) {
      console.log(`[notifications] Skipping push — user ${userId} has notifications disabled`);
      return;
    }

    const tokens = await getUserPushTokens(userId);
    if (tokens.length === 0) {
      console.log(`[notifications] No push tokens for user ${userId}`);
      return;
    }

    await sendToTokens(tokens, payload);
  } catch (error) {
    console.error(`[notifications] Failed to send push to user ${userId}:`, error);
  }
}

/**
 * Send a push notification to multiple users.
 */
export async function sendPushNotificationBulk(
  userIds: string[],
  notificationType: string,
  payload: NotificationPayload,
): Promise<void> {
  const promises = userIds.map((uid) => sendPushNotification(uid, notificationType, payload));
  await Promise.allSettled(promises);
}

/**
 * Send a notification to specific Expo push tokens.
 */
async function sendToTokens(
  tokens: string[],
  payload: NotificationPayload,
): Promise<void> {
  const client = getExpoClient();

  // Build the messages array
  const messages: ExpoPushMessage[] = tokens
    .filter((token) => Expo.isExpoPushToken(token))
    .map((token) => ({
      to: token,
      sound: payload.sound ?? 'default',
      body: payload.body,
      title: payload.title,
      data: payload.data ?? {},
      priority: payload.priority ?? 'high',
      badge: payload.badge,
      channelId: payload.channelId,
      ...(payload.group ? { tag: payload.group, collapseId: payload.group } : {}),
    }));

  if (messages.length === 0) return;

  // Chunk and send
  const chunks = client.chunkPushNotifications(messages);
  const tickets: ExpoPushTicket[] = [];

  for (const chunk of chunks) {
    try {
      const ticketChunk = await client.sendPushNotificationsAsync(chunk);
      tickets.push(...ticketChunk);
    } catch (error) {
      console.error('[notifications] Error sending chunk:', error);
    }
  }

  // Log any ticket errors (actual delivery failures)
  for (const ticket of tickets) {
    if (ticket.status === 'error') {
      console.error(`[notifications] Ticket error: ${ticket.message}`, ticket.details);
    }
  }

  // Fire-and-forget receipt checking for DeviceNotRegistered cleanup
  // Note: Full receipt checking is deferred — Expo recommends waiting ~30s before polling
  // and the token-to-receipt mapping would need to be persisted for accurate cleanup.
  // For now, we log errors and rely on unregister-token on app logout/cleanup.
}

// ─── Event Handlers ──────────────────────────────────────

/**
 * Where a tapped match push leads. The name only heads the chat screen it
 * opens; no push ever shows it.
 */
export interface PushChatTarget {
  matchId: string;
  partnerId: string;
  partnerName: string;
}

/**
 * Send notifications for various platform events. A push is read on a lock
 * screen, so none of them names a person or quotes a message: they say how
 * many are waiting, and a tap opens the right screen.
 */
export const notificationEvents = {
  /**
   * A message the recipient has not seen. The push says how many messages
   * are waiting across all their chats, and a tap always opens the chat
   * list: one tray entry covers every sender, so it cannot stand for any
   * one chat.
   */
  async newMessage(userId: string): Promise<void> {
    let unread = 1;
    try {
      const result = await query<{ unread: number }>(
        `SELECT COUNT(*)::int AS unread
         FROM ${TABLES.MESSAGES} msg
         JOIN ${TABLES.MATCHES} m ON m.id = msg.match_id
         WHERE m.is_active = TRUE
           AND (m.user_a_id = $1 OR m.user_b_id = $1)
           AND msg.sender_id <> $1
           AND msg.read_at IS NULL`,
        [userId],
      );
      unread = Math.max(1, result.rows[0]?.unread ?? 1);
    } catch (error) {
      // The count only shapes the text; the push itself still goes out
      console.warn('[notifications] Could not count unread messages:', (error as Error)?.message);
    }

    await sendPushNotification(userId, 'new.message', {
      title: unread > 1 ? 'New messages' : 'New message',
      body: unread > 1 ? `You have ${unread} new messages!` : 'You have a message!',
      data: { type: 'new.message', screen: 'ChatList' },
      sound: 'default',
      badge: unread,
      channelId: 'messages',
      group: PUSH_GROUPS.messages,
    });
  },

  /**
   * A new match. The push says how many new matches are waiting: matches the
   * recipient has neither written in nor opened (no message of theirs, none
   * read), always counting this one. While this is the only one a tap opens
   * the new chat, where the opening line waits, otherwise the chat list.
   */
  async newMatch(userId: string, chat: PushChatTarget): Promise<void> {
    let fresh = 1;
    try {
      const result = await query<{ fresh: number }>(
        `SELECT COUNT(*)::int AS fresh
         FROM ${TABLES.MATCHES} m
         WHERE m.is_active = TRUE
           AND (m.user_a_id = $1 OR m.user_b_id = $1)
           AND (m.id = $2 OR NOT EXISTS (
             SELECT 1 FROM ${TABLES.MESSAGES} msg
             WHERE msg.match_id = m.id
               AND (msg.sender_id = $1 OR msg.read_at IS NOT NULL)
           ))`,
        [userId, chat.matchId],
      );
      fresh = Math.max(1, result.rows[0]?.fresh ?? 1);
    } catch (error) {
      console.warn('[notifications] Could not count new matches:', (error as Error)?.message);
    }

    await sendPushNotification(userId, 'new.match', {
      title: fresh > 1 ? 'New matches' : 'New match',
      body: fresh > 1 ? `You have ${fresh} new matches! Say hi` : 'You have a new match! Say hi',
      data: fresh > 1
        ? { type: 'new.match', screen: 'ChatList' }
        : { type: 'new.match', screen: 'Chat', matchId: chat.matchId, partnerId: chat.partnerId, partnerName: chat.partnerName },
      sound: 'default',
      channelId: 'messages',
      group: PUSH_GROUPS.matches,
    });
  },

  /**
   * A like waiting on the recipient. The push says how many people are
   * waiting in their Likes list, the number the tab badge shows; who they
   * are is for the list itself (Premium, or a free account's revealed few).
   */
  async newLike(userId: string): Promise<void> {
    let pending = 1;
    try {
      const result = await query<{ pending: number }>(
        `SELECT COUNT(*)::int AS pending FROM ${TABLES.USER_INTERACTIONS}
         WHERE target_id = $1 AND action IN ('like', 'super_like')
           AND is_mutual = FALSE AND responded_at IS NULL`,
        [userId],
      );
      pending = Math.max(1, result.rows[0]?.pending ?? 1);
    } catch (error) {
      console.warn('[notifications] Could not count pending likes:', (error as Error)?.message);
    }

    await sendPushNotification(userId, 'new.like', {
      title: 'New like',
      body: pending > 1 ? `${pending} people liked your profile!` : '1 person liked your profile!',
      data: { type: 'new.like', screen: 'Likes' },
      channelId: 'default',
      group: PUSH_GROUPS.likes,
    });
  },
};
