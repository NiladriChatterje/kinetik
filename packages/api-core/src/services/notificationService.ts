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
}

/**
 * Send a push notification to a single user.
 * Respects the user's notification preferences.
 */
export async function sendPushNotification(
  userId: string,
  notificationType: string,
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
  async matchFound(userId: string, partnerName: string): Promise<void> {
    await sendPushNotification(userId, 'match.found', {
      title: 'New Match! 🎉',
      body: `You matched with ${partnerName}! Say hello and plan your date.`,
      data: { type: 'match.found', screen: 'LockStatus' },
    });
  },

  async vibeCheckStart(userId: string, partnerName: string, vibeId: string): Promise<void> {
    await sendPushNotification(userId, 'vibe.check', {
      title: 'Vibe Check Time!',
      body: `${partnerName} is ready to vibe. Join the call!`,
      data: { type: 'vibe.check', screen: 'VibeCheck', vibeId },
      priority: 'high',
    });
  },

  async flashWindowReminder(userId: string, city: string, minutesUntilStart: number): Promise<void> {
    // Check if the user wants flash window reminders
    const prefsResult = await query<{ flash_window_reminder: boolean }>(
      `SELECT flash_window_reminder FROM ${TABLES.USER_PREFERENCES} WHERE user_id = $1`,
      [userId],
    );

    // Check if user wants flash window reminders (default to true)
    if (prefsResult.rows[0]?.flash_window_reminder === false) {
      return;
    }

    await sendPushNotification(userId, 'flash.window', {
      title: `⚡ Flash Window in ${minutesUntilStart} min`,
      body: `The next flash window in ${city} is about to start. Get ready!`,
      data: { type: 'flash.window', screen: 'FlashCountdown' },
    });
  },

  async newMessage(userId: string, senderName: string, messagePreview: string): Promise<void> {
    await sendPushNotification(userId, 'new.message', {
      title: senderName,
      body: messagePreview,
      data: { type: 'new.message', screen: 'ActiveRadar' },
      sound: 'default',
    });
  },

  async newLike(userId: string, likerName: string): Promise<void> {
    await sendPushNotification(userId, 'new.like', {
      title: 'New Like 💘',
      body: `${likerName} liked your profile! See who likes you.`,
      data: { type: 'new.like', screen: 'Likes' },
    });
  },

  async duoInvite(userId: string, inviterName: string): Promise<void> {
    await sendPushNotification(userId, 'duo.invite', {
      title: 'Duo Crew Invite 🎯',
      body: `${inviterName} invited you to be their wingman!`,
      data: { type: 'duo.invite', screen: 'DuoWingman' },
    });
  },
};
