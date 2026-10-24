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
}

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
 * Send notifications for various platform events.
 * Meant to be called from Kafka consumers or directly from route handlers.
 */
export const notificationEvents = {
  /**
   * A message the recipient has not seen. While only one chat has unread
   * messages the push names the sender and shows the text, and a tap opens
   * that chat. Once a second chat has unread messages too, the push says
   * how many are waiting and a tap opens the chat list: the phone would
   * otherwise pile up one banner per message from several people.
   */
  async newMessage(
    userId: string,
    senderName: string,
    messagePreview: string,
    chat?: { matchId: string; partnerId: string },
  ): Promise<void> {
    let unread = 0;
    let chats = 0;
    try {
      const result = await query<{ unread: number; chats: number }>(
        `SELECT COUNT(*)::int AS unread, COUNT(DISTINCT msg.match_id)::int AS chats
         FROM ${TABLES.MESSAGES} msg
         JOIN ${TABLES.MATCHES} m ON m.id = msg.match_id
         WHERE m.is_active = TRUE
           AND (m.user_a_id = $1 OR m.user_b_id = $1)
           AND msg.sender_id <> $1
           AND msg.read_at IS NULL`,
        [userId],
      );
      unread = result.rows[0]?.unread ?? 0;
      chats = result.rows[0]?.chats ?? 0;
    } catch (error) {
      // The count only shapes the text; the push itself still goes out
      console.warn('[notifications] Could not count unread messages:', (error as Error)?.message);
    }

    const grouped = chats > 1;
    await sendPushNotification(userId, 'new.message', {
      title: grouped ? 'Kinetik' : senderName,
      body: grouped ? `${unread} unread messages` : messagePreview,
      data: grouped || !chat
        ? { type: 'new.message', screen: 'ChatList' }
        : { type: 'new.message', screen: 'Chat', matchId: chat.matchId, partnerId: chat.partnerId, partnerName: senderName },
      sound: 'default',
      badge: unread > 0 ? unread : undefined,
      channelId: 'messages',
    });
  },

  /** likerName is null for a free user: who liked them is a Premium feature. */
  async newLike(userId: string, likerName: string | null): Promise<void> {
    await sendPushNotification(userId, 'new.like', {
      title: 'New Like',
      body: likerName
        ? `${likerName} liked your profile! See who likes you.`
        : 'Someone liked your profile! Upgrade to Premium to see who.',
      data: { type: 'new.like', screen: 'Likes' },
      channelId: 'default',
    });
  },
};
