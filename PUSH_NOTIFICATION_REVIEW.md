# Push Notification Pipeline — Review & Improvement Suggestions

> **Last updated:** July 12, 2026
> **Audited files:** `notificationService.ts`, `notifications.ts` (routes), `matches.ts`, `notificationStore.ts`, `useNotifications.ts`, `NotificationPreferencesScreen.tsx`, `auth.ts`

---

## 1. Architecture Overview

```
Mobile App                     API Core (Fastify)              Expo Push Service
┌─────────────────┐           ┌──────────────────────┐        ┌─────────────────┐
│ Auth/login      │───token──▶│ JWT auth              │        │                 │
│                 │           │                      │        │                 │
│ OTP verify      │───reg────▶│ registerPushToken()   │──push──▶                 │
│                 │  token    │  (upsert into DB)     │  token  │                 │
│                 │           │                      │        │                 │
│ Event triggers  │           │ notificationEvents:  │        │                 │
│ (swipe, match,  │           │  · newLike()         │──push──▶                 │
│  message, etc)  │           │  · matchFound()      │  notify │                 │
│                 │           │  · newMessage()      │────────▶│                 │
│                 │           │  · vibeCheckStart()   │         │                 │
└─────────────────┘           └──────────────────────┘        └─────────────────┘
                                      │
                                      ▼
                               ┌──────────────┐
                               │  PostgreSQL   │
                               │  push_tokens  │
                               │  user_prefs   │
                               └──────────────┘
```

---

## 2. Current Flow (Step by Step)

### Token Registration
1. **Mobile:** `notificationStore.ts:initialize()` → `registerForPushNotifications()`
2. Requests Expo permissions → gets `ExpoPushToken` → calls `POST /notifications/register-token`
3. **Backend:** `registerPushToken()` validates token with `Expo.isExpoPushToken()`, upserts into `push_tokens` table

### Sending a Notification
1. **Trigger:** Route handler calls `notificationEvents.newLike()`, `notificationEvents.matchFound()`, etc.
2. `sendPushNotification(userId, type, payload)`:
   - Checks `user_preferences.push_enabled` → skips if disabled
   - Fetches active push tokens from DB via `getUserPushTokens(userId)`
   - Calls `sendToTokens(tokens, payload)` → builds ExpoPushMessages, chunks, sends
3. Tickets are logged but **receipts are NOT checked** (see note in code)

### Preferences Screen
- `NotificationPreferencesScreen.tsx` allows toggling Push Notifications and Flash Window Reminders
- Changes are persisted via `PUT /notifications/preferences`

---

## 3. Identified Failure Points

### 🔴 CRITICAL: No Device Token Cleanup

**Location:** `notificationService.ts:164`

```typescript
// Fire-and-forget receipt checking for DeviceNotRegistered cleanup
// Note: Full receipt checking is deferred — Expo recommends waiting ~30s before polling
// and the token-to-receipt mapping would need to be persisted for accurate cleanup.
// For now, we log errors and rely on unregister-token on app logout/cleanup.
```

**Risk:** If a user uninstalls the app or revokes push permissions, `DeviceNotRegistered` errors will never clean up stale tokens. Over time, the `push_tokens` table accumulates dead tokens, causing:
- Wasted API calls to Expo (sending to dead tokens)
- Slightly higher latency (more tokens to iterate)
- No user-visible impact, but it's technical debt that grows linearly with inactive users

**When it becomes critical:** Once you have 10k+ users, the stale-to-active token ratio can be 30%+.

---

### 🔴 CRITICAL: No Notification Queue / Retry on Expo Failure

**Location:** `notificationService.ts:148-152`

```typescript
for (const chunk of chunks) {
    try {
      const ticketChunk = await client.sendPushNotificationsAsync(chunk);
      tickets.push(...ticketChunk);
    } catch (error) {
      console.error('[notifications] Error sending chunk:', error);
    }
  }
```

**Risk:** If Expo's API is temporarily down or returns a 429 (rate limit), the notification is **silently dropped**. There's no:
- Retry with exponential backoff
- Message queue (e.g., Bull/BullMQ backed by Redis)
- Dead-letter queue for persistent failures

**When it becomes critical:** During peak hours (8:30 PM flash windows), if Expo has an outage, all notifications during that window are lost forever.

---

### 🟡 HIGH: No Rate Limiting on Expo API Calls

**Location:** `notificationService.ts:130-153`

Expo has rate limits (`chunkPushNotifications` chunks at 100 per request), but:
- No tracking of how many chunks are being sent per second/minute
- If you send 100 push notifications in 1 second across 10 users, you could hit Expo's undocumented rate limits
- No circuit breaker pattern

---

### 🟡 HIGH: `sendPushNotification` is Fire-and-Forget

**Location:** Called from `matches.ts:278-279`, `matches.ts:308`, `matches.ts:456`, `matches.ts:627`

All callers `await` the notification, but:
- If `sendPushNotification` throws, the entire request fails (though `sendPushNotification` catches and logs errors, so it won't crash the request)
- More importantly: **notifications are sequential** — `matches.ts:278-279` calls two `await notificationEvents.matchFound(...)` in sequence, doubling the wait time
- No timeout — if Expo hangs, the request hangs

---

### 🟡 HIGH: No Badge Count Tracking

**Location:** `notificationService.ts`

The `NotificationPayload` interface supports `badge?: number`, but **none** of the `notificationEvents` handlers set a badge count. iOS/Android badge numbers won't update.

---

### 🟢 MEDIUM: Expo Go Limitations

**Location:** `notificationStore.ts:67-75`

```typescript
const isExpoGo = Constants.executionEnvironment === 'storeClient';
if (isExpoGo) {
    console.log('[notifications] Running in Expo Go — push notifications require a development build.');
} else if (Notifications) {
    await get().registerForPushNotifications();
}
```

This correctly detects Expo Go, but the user sees a console log only — no in-app feedback that push won't work.

---

### 🟢 MEDIUM: Push Token Validation is Silent

**Location:** `notificationService.ts:27-29`

```typescript
if (!Expo.isExpoPushToken(token)) {
    console.warn(`[notifications] Invalid Expo push token for user ${userId}: ${tokenPreview}`);
    return;
}
```

When an invalid token is provided, it silently returns without registering. No error is returned to the client, so the user thinks push is set up but it never will be.

---

### 🟢 MEDIUM: Android Notification Channels Hardcoded

**Location:** `notificationStore.ts:44-66`

Android channels (`default`, `messages`, `vibe`) are created with specific importance levels, but:
- The channel names don't map to actual notification types from the backend (e.g., `vibe.check` → should go to `vibe` channel)
- Messages sent via Expo push don't specify `channelId` — they all go to `default`
- This means the channel configuration is decorative; all notifications use default settings on Android

---

### 🟢 MEDIUM: Flash Window Reminder Preference Not Fully Respected

**Location:** `notificationService.ts:198-205`

The `flashWindowReminder` pref is checked in a separate DB query in `flashWindowReminder()`, but the main `sendPushNotification()` function also checks `push_enabled`. This means a user can disable push entirely but still get flash window reminders if that function is called directly. The code does check `flash_window_reminder` explicitly, but it's an extra DB query per notification.

---

### 🔵 LOW: Mixed `camelCase` / `snake_case` in Preferences

**Location:** `notifications.ts` (routes) vs `notificationStore.ts`

The routes use `pushEnabled` and `flashWindowReminder` (camelCase), but the DB columns are `push_enabled` and `flash_window_reminder`. The mapping is handled correctly, but it's worth noting for consistency.

---

### 🔵 LOW: Notification Type Screen Mapping Mismatch

**Location:** `notificationService.ts:177-232`

The `data.screen` field in each notification payload maps notification types to screens:
- `match.found` → `'LockStatus'`
- `vibe.check` → `'VibeCheck'`
- `flash.window` → `'FlashCountdown'`
- `new.message` → `'ActiveRadar'`
- `new.like` → `'Likes'`
- `duo.invite` → `'DuoWingman'`

**Issue:** Some of these screen names don't match the `RootStackParamList` parameter types exactly (e.g., `'ActiveRadar'` exists but `'FlashCountdown'` is also a valid route). If the navigation layer doesn't handle these screen names with a `useEffect` on `lastNotificationResponse`, tapping a notification will do nothing.

---

## 4. Suggested Improvements (Prioritized)

### P0 — Implement ASAP

#### ✅ 1. DeviceNotRegistered Token Cleanup
Add receipt polling after sending notifications:

```typescript
// After sending chunks, store the mapping of ticket -> token
// Then poll receipts after 30s to clean up DeviceNotRegistered errors
const tokenByTicketId = new Map<string, string>();
const ticketIds: string[] = [];

for (const ticket of tickets) {
    if (ticket.status === 'ok') {
        tokenByTicketId.set(ticket.id, /* original token */);
        ticketIds.push(ticket.id);
    }
}

// Poll receipts after 30s
setTimeout(async () => {
    const receiptIds = ticketIds.filter(id => tokenByTicketId.has(id));
    if (receiptIds.length === 0) return;
    
    const receiptChunks = client.chunkPushNotificationReceipts(receiptIds);
    for (const chunk of receiptChunks) {
        const receipts = await client.getPushNotificationReceiptsAsync(chunk);
        for (const [receiptId, receipt] of Object.entries(receipts)) {
            if (receipt.status === 'error' && receipt.details?.error === 'DeviceNotRegistered') {
                const staleToken = tokenByTicketId.get(receiptId);
                if (staleToken) {
                    // Soft-delete the stale token
                    await query(
                        `UPDATE push_tokens SET is_active = FALSE WHERE token = $1`,
                        [staleToken],
                    );
                    console.log(`[notifications] Cleaned up stale token: ${staleToken.slice(0, 20)}...`);
                }
            }
        }
    }
}, 30000);
```

#### ✅ 2. Add Retry Logic with Exponential Backoff
Wrap the Expo API call with a retry:

```typescript
async function sendToTokensWithRetry(tokens: string[], payload: NotificationPayload, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            await sendToTokens(tokens, payload);
            return;
        } catch (error) {
            if (attempt === retries) throw error;
            const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
            console.warn(`[notifications] Retry ${attempt}/${retries} after ${delay}ms`);
            await new Promise(r => setTimeout(r, delay));
        }
    }
}
```

### P1 — Important Improvements

#### ✅ 3. Parallelize Notifications
Instead of sequential `await` calls:

```typescript
// Before (sequential — slow):
await notificationEvents.matchFound(userId, partnerName);
await notificationEvents.matchFound(targetUserId, swiperName);

// After (parallel — fast):
await Promise.all([
    notificationEvents.matchFound(userId, partnerName),
    notificationEvents.matchFound(targetUserId, swiperName),
]);
```

#### ✅ 4. Add Badge Count to Notifications
Track unread notifications per user in Redis and include in payload:

```typescript
// In sendPushNotification:
const badgeCount = await redis.incr(REDIS_KEYS.USER_UNREAD_NOTIFICATIONS(userId));
payload.badge = badgeCount;
```

#### ✅ 5. Add Timeout to Expo API Calls
Use `AbortController` or a timeout wrapper:

```typescript
// expo-server-sdk doesn't natively support AbortController,
// but you can add a Promise.race timeout:
const TIMEOUT_MS = 10_000;
const result = await Promise.race([
    client.sendPushNotificationsAsync(chunk),
    new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Expo API timeout')), TIMEOUT_MS)
    ),
]);
```

### P2 — Nice to Have

#### ✅ 6. Add Rate Limiter for Expo Calls
Track sending rate and back off if approaching limits:

```typescript
const expoRateLimiter = {
    sentThisMinute: 0,
    lastReset: Date.now(),
    async send(chunk: ExpoPushMessage[]) {
        const now = Date.now();
        if (now - this.lastReset > 60_000) {
            this.sentThisMinute = 0;
            this.lastReset = now;
        }
        if (this.sentThisMinute > 500) { // Expo's docs suggest ~600/min
            await new Promise(r => setTimeout(r, 1000));
        }
        this.sentThisMinute += chunk.length;
        return client.sendPushNotificationsAsync(chunk);
    },
};
```

#### ✅ 7. Add Android Channel ID Mapping
Map notification types to correct Android channels:

```typescript
const CHANNEL_MAP: Record<string, string> = {
    'new.message': 'messages',
    'vibe.check': 'vibe',
    'match.found': 'default',
    'new.like': 'default',
    'flash.window': 'default',
    'duo.invite': 'default',
};

// In sendToTokens:
const channelId = CHANNEL_MAP[notificationType] || 'default';
messages.push({
    to: token,
    channelId,
    // ...other fields
});
```

#### ✅ 8. Add In-App Feedback for Expo Go
Show a toast/banner in the NotificationPreferences screen if running in Expo Go:

```typescript
// In NotificationPreferencesScreen:
const isExpoGo = Constants.executionEnvironment === 'storeClient';
if (isExpoGo) {
    return (
        <Card style={styles.warningCard}>
            <Ionicons name="warning-outline" size={20} color={colors.warning} />
            <Text>Push notifications require a development build. Install via EAS Build.</Text>
        </Card>
    );
}
```

---

## 5. Summary of Risk Levels

| # | Issue | Risk | Impact |
|---|-------|------|--------|
| 1 | No DeviceNotRegistered cleanup | 🔴 Critical | Dead token accumulation, wasted API calls |
| 2 | No retry on Expo failure | 🔴 Critical | Notifications silently lost during Expo outage |
| 3 | No rate limiting on Expo sends | 🟡 High | Potential 429 rate limit blocks |
| 4 | Sequential notification sends | 🟡 High | Slow requests during match events |
| 5 | No badge count | 🟡 High | No iOS/Android badge number updates |
| 6 | No API timeout | 🟡 High | Requests could hang indefinitely |
| 7 | Expo Go lacks push feedback | 🟢 Medium | Devs unaware push won't work |
| 8 | Silent invalid token registration | 🟢 Medium | Users think push is set up but it's not |
| 9 | Android channels disconnected | 🟢 Medium | Channel distinction is decorative |
| 10 | Screen name mismatches in data payload | 🔵 Low | Notification tap may not navigate correctly |
