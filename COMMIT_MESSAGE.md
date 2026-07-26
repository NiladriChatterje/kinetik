feat: view-once media (WhatsApp-style ephemeral photos/videos)

## Overview

Implements a full-stack "view once" feature for chat media, similar to
WhatsApp's View Once. Senders can mark photos as view-once when sending.
The recipient can view the media a single time — after closing the viewer,
the file is permanently deleted from storage and the URL is cleared
client-side. Screenshot protection is enforced on Android via FLAG_SECURE.

## Backend Changes

### Database (`006_add_view_once_media.sql`)
- Added `is_view_once BOOLEAN NOT NULL DEFAULT FALSE` to `chat_media`
- Added `viewed_at TIMESTAMPTZ` to track when media was viewed
- Partial index on `(id, sender_id) WHERE is_view_once = TRUE AND viewed_at IS NULL`
  for fast lookups of unviewed one-time media

### API Core (`packages/api-core/`)
- **matches.ts — Media upload**: Accepts `view_once=true` query param.
  When set, the uploaded file URL and metadata are stored with
  `is_view_once = TRUE`. Supports both encrypted (MinIO) and direct uploads.
- **matches.ts — View endpoint**: `POST /media/:mediaId/view` atomically
  marks media as viewed using `UPDATE ... WHERE viewed_at IS NULL RETURNING *`
  to prevent race conditions (double-view). On success, deletes the file
  from MinIO storage (both full image and thumbnail), then publishes a
  `media:viewed` event to Redis for real-time sync.
- **matches.ts — Messages API**: Returns `isViewOnce` and `viewedAt` fields
  in the chat message response.
- **photoStorage.ts**: Added `deleteChatFile(key)` to remove individual
  files from MinIO by key.

### Realtime (`packages/realtime/`)
- **chat.ts — Broadcast interface**: Extended `broadcastMessage` type to
  include `isViewOnce` and `viewedAt` on media objects.
- **chat.ts — media:viewed routing**: Added dedicated channel subscription
  for `media:viewed` events from Redis. The handler emits `WsEvent.MEDIA_VIEWED`
  to the match room so the sender sees real-time "Opened" status.

### Shared Types (`packages/shared/`)
- Extended `ChatMedia` interface with `isViewOnce?: boolean` and
  `viewedAt?: string` fields.

## Mobile Changes

### Dependency
- Installed `expo-screen-capture` for screenshot prevention.

### API Service (`packages/mobile/src/services/api.ts`)
- Added `markMediaViewed(mediaId: string)` method.
- Updated `sendMediaMessage()` to accept optional `viewOnce` param.

### ChatScreen (`packages/mobile/src/screens/match/ChatScreen.tsx`)

**Screenshot Prevention:**
- Added `usePreventScreenCapture()` on mount — applies FLAG_SECURE on
  Android to block screenshots and screen recording across the entire chat.

**View-Once Toggle in Media Picker:**
- Toggle row with checkbox icon and "View once" label in the media picker
  bottom sheet. Shows helper text "Media will disappear after viewing".
- When active, the toggle row is highlighted with the primary accent color
  and border.

**Sender Experience:**
- Own view-once images render with a "View once" overlay badge.
- Sender can preview their own view-once images normally (no burn flow).
- After the recipient views it, the sender sees an "Opened" status with
  a double-checkmark icon in the message bubble.

**Receiver Experience (Before Viewing):**
- Unviewed one-time media shows a dark rounded CTA card with:
  • Eye icon in a frosted circle with a numeric "1" badge
  • "View once" title
  • "Tap to open" hint text

**One-Time Viewer Modal:**
- Fullscreen black modal with `statusBarTranslucent`.
- Warning banner: "This media can only be viewed once" with eye-off icon.
- Close button (X) in top-right frosted circle.
- The image fills the screen (`resizeMode="contain"`).
- Footer hint: flame icon + "Tap anywhere or press close to burn this media".
- For videos, shows an in-modal play button that opens the external player
  and immediately burns the media.

**Burn Flow (Closing the Viewer):**
- Calls `markMediaViewed(mediaId)` API on close.
- On success: clears the URL and thumbnail from local message state,
  sets `viewedAt`. The message bubble now shows "Viewed" (receiver) or
  "Opened" (sender).
- On network failure: shows an alert but does NOT clear the URL, so the
  user can retry. The backend file remains intact until confirmed.

**Real-Time Sync:**
- Listens for `media:viewed` socket events.
- When the recipient views the media, the sender's message updates to
  show "Opened" status in real-time without needing a refresh.

### Race Condition Protection
- The backend view endpoint uses a single atomic UPDATE with
  `WHERE viewed_at IS NULL RETURNING *`.
- Only the first concurrent request succeeds — subsequent requests get
  a 404 (already viewed).
- File deletion errors are caught and logged, never bubble up to the client.
