# Kinetik App — Features & Status Document

> **Last updated:** August 14, 2026
> **Project:** Kinetik — real-time matchmaking platform (skip the chat, meet already)

---

## 1. Authentication & Onboarding

| Feature | Status | Details |
|---------|--------|---------|
| Phone-based Auth | ✅ Implemented | Phone + password login/register flow |
| OTP Verification | ✅ Implemented | 6-digit SMS-based OTP with auto-advance input, 30s resend cooldown |
| JWT Token Persistence | ✅ Implemented | `expo-secure-store` for token storage, auto-restore on app launch |
| Identity Setup (Step 1/5) | ✅ Implemented | DOB (DD/MM/YYYY format, 18+ validation), gender selector, pronouns |
| Location Permission (Step 2/5) | ✅ Implemented | GPS permission request, H3 hex grid visualization, background updates |
| Photo Upload (Step 3/5) | ✅ Implemented | Camera/gallery pick, compress & upload pipeline, 2-photo minimum, 6 slots |
| Face Verification (Step 4/5) | ✅ Implemented | Front-facing camera selfie, preview/retake, face guide overlay; face match against profile photos runs fully on-device (ML Kit + MobileFaceNet TFLite), result self-reported to the API. Identity match only — no liveness or anti-spoofing check. See FACE_VERIFICATION_ONDEVICE.md |
| KYC Document Upload (Step 5/5) | ✅ Implemented | Passport/license/national ID picker, PDF/JPG/PNG, 20MB limit, upload & skip |
| **KYC Face Verification (Document vs Profile)** | ✅ **New** | **Free MediaPipe-based pipeline: extracts face from uploaded ID (JPEG/PNG/PDF), compares against profile photos via landmark-based cosine similarity, updates kyc_status to 'verified' on match** |
| **KYC Verification in Settings** | ✅ **New** | **"KYC Verification" option in ProfileLedgerScreen with status badge (Verified/Pending/Not Verified), navigates to KYCScreen from settings** |
| **KYC Settings Navigation Fix** | ✅ **New** | **KYCScreen handles both onboarding stack and root stack navigation — works correctly when accessed from profile settings** |
| Onboarding Progress Tracking | ✅ Implemented | Step persisted in DB, resume on re-login, smart skip for already-completed steps |

---

## 2. Match/Swipe System

| Feature | Status | Details |
|---------|--------|---------|
| Swipe Card UI | ✅ Implemented | Tinder-style swipeable cards with `PanResponder`, LIKE/PASS stickers, rotation animation |
| Like Action | ✅ Implemented | Swipe right or tap heart button → records interaction in `user_interactions` |
| Pass Action | ✅ Implemented | Swipe left or tap X button |
| Super Like | ✅ Implemented | Star button, blue badge, sends highlighted notification, daily limits (5 free / 25 premium) |
| Mutual Match Detection | ✅ Implemented | On like, checks if target already liked the actor → creates match instantly |
| Profile Discovery | ✅ Implemented | Filters by age, gender, distance; excludes already-interacted users; random ordering |
| Swipe Limits | ✅ Implemented | 30 right-swipes per free account (lifetime, not daily), effectively unlimited for premium; counted from user_interactions; low-budget counter shown in the deck header from 5 remaining |
| Super Like Limits | ✅ Implemented | 5/day free, 25/day premium, tracked via Redis with 24h expiry |
| Incoming Likes List | ✅ Implemented | `GET /matches/likes` returns who liked you with photos, bio, super-like indicator |
| Like-Back / Discard | ✅ Implemented | `POST /matches/respond` lets you like back (creates match) or discard |
| Unread Like Badge | ✅ Implemented | Red badge on heart icon in Match tab, increments on real-time `likes:new` events |
| Match Popup Animation | ✅ Implemented | "It's a Match!" animated card with hearts, partner photo, glow effect, "Say Hello" / "Keep Swiping" |

---

## 3. Push Notifications

| Feature | Status | Details |
|---------|--------|---------|
| Expo Push Token Registration | ✅ Implemented | Token stored in `push_tokens` table, upserted per user+token combination |
| Token Unregistration | ✅ Implemented | Soft-delete on logout (sets `is_active = FALSE`) |
| Notification Preferences | ✅ Implemented | Per-user `push_enabled` flag checked before sending |
| **New Like Notification** | ✅ **Working** | **When user A swipes right on user B → push sent to user B with title "New Like 💘" and body "{name} liked your profile!"** |
| New Match Notification | ✅ Implemented | Both users notified: `"You matched with {partnerName}! Say hello and plan your date."` |
| New Message Notification | ✅ Implemented | Partner notified with sender's name and message preview |
| Vibe Check Notification | ✅ Implemented | Alert when partner is ready for vibe call |
| Flash Window Reminder | ✅ Implemented | Configurable reminders via user preference check |
| Duo Crew Invite | ✅ Implemented | Wingman invite notification |

> **⚠️ Delivery Notes:** Actual push delivery depends on:
> - User having registered an Expo push token
> - Push notifications being enabled in preferences
> - Expo push service operationality

---

## 4. Real-Time Infrastructure

| Feature | Status | Details |
|---------|--------|---------|
| Socket.IO Server | ✅ Implemented | Namespace-based WebSocket server on port 3002 |
| Redis Pub/Sub Adapter | ✅ Implemented | Cross-instance Socket.IO room/event routing via `@socket.io/redis-adapter` |
| Redis Event Bus (separate instance) | ✅ Implemented | Channels: `event:match`, `event:user`, `event:window`, `event:vibe`, `event:payment` on a dedicated Redis instance (`redis-events:6380`) — replaces Kafka |
| JWT Socket Auth | ✅ Implemented | Token verified on handshake for all namespaces |
| Connection Namespace (/) | ✅ Implemented | Basic connection/disconnect events |
| Presence Namespace (/presence) | ✅ Implemented | Online status, heartbeat, presence updates |
| Chat Namespace (/chat) | ✅ Implemented | Join/leave rooms, message relay, typing, read receipts |
| Flash Window Namespace | ✅ Implemented | Queue management, countdown, join/leave |
| Vibe Check Namespace | ✅ Implemented | Audio toggle, phase changes, decisions |
| 1:1 Call Signaling (LiveKit) | ✅ Implemented | `call:invite/accept/decline/cancel/busy` over the shared `/chat` socket → Redis pub/sub → personal rooms; per-socket busy state |
| Graceful Shutdown | ✅ Implemented | SIGTERM/SIGINT handlers for Redis, event bus, Socket.IO |

---

## 5. Chat / Messaging

| Feature | Status | Details |
|---------|--------|---------|
| **Real-Time Chat** | ✅ **Working** | **Socket.IO `chat:message` event — instant delivery across all connected clients** |
| Message History | ✅ Implemented | `GET /conversations/:id/messages` — returns last 200 messages ASC |
| Send Message API | ✅ Implemented | `POST /conversations/:id/messages` — persists via PostgreSQL |
| **Cross-Instance Delivery** | ✅ **Working** | **Redis pub/sub `chat:messages` channel — api-core publishes, realtime service broadcasts** |
| Chat List / Conversations | ✅ Implemented | `GET /matches/conversations` — shows partner info, last message, unread count, timestamps |
| Unread Message Count | ✅ Implemented | SQL count of unread messages per conversation |
| Read Receipts | ✅ Implemented | `chat:read` event via Socket.IO with `read_at` timestamp; checkmark-done icon |
| Typing Indicators | ✅ Implemented | `chat:typing` event — "Typing..." status in header, auto-clear after 2s |
| Push Notification for New Message | ✅ Implemented | Partner gets push notification with sender name + message preview |
| Optimistic Message Send | ✅ Implemented | Messages appear instantly in UI, ID replaced after server confirmation |
| Empty Chat State | ✅ Implemented | "Say hello to {partnerName}!" placeholder |
| Friendly Timestamps | ✅ Implemented | "Just now", "5m", "3h", "2d" format in conversation list |

---

## 6. Flash Window (Live Matching)

| Feature | Status | Details |
|---------|--------|---------|
| Countdown Timer | ✅ Implemented | Animated countdown to next 8:30 PM window |
| Location-based Queue Stats | ✅ Implemented | Live users, in queue, matches count |
| Area Details Modal | ✅ Implemented | Bottom sheet with city, county, region, country, H3 hex cell, coordinates, last polled time |
| Animated Radar Screen | ✅ Implemented | Pulsing radar ring, sweeping animation, blip dots, queue enter/leave |
| Queue Size Display | ✅ Implemented | Shows total in queue |
| Average Match Time | ✅ Implemented | "Avg. match time: 23 seconds" |
| H3 Spatial Indexing | ✅ Implemented | Users placed in hexagonal grid cells for proximity matching |
| Event Bus for Window Events | ✅ Implemented | `event:window` channel on Redis event bus for real-time window state |

---

## 7. Vibe Check (3-Minute Call)

| Feature | Status | Details |
|---------|--------|---------|
| Phase Timer | ✅ Implemented | 180-second countdown divided into 3 phases |
| Phase 1 — Silhouette (0-1min) | ✅ Implemented | Audio-only, partner shown as outline/silhouette |
| Phase 2 — Blurred (1-2min) | ✅ Implemented | Partner image begins revealing |
| Phase 3 — Revealed (2-3min) | ✅ Implemented | Full profile revealed |
| Decision Phase | ✅ Implemented | "Lock It In" vs "Pass" buttons after call ends |
| Audio Controls | ✅ Implemented | Mute/unmute mic, end call, speaker toggle |
| Phase Dots Indicator | ✅ Implemented | 3 dots showing current phase |
| Navigation to Commitment | ✅ Implemented | "Lock" → Commitment screen, "Pass" → go back |

---

## 8. Commitment & Scheduling

| Feature | Status | Details |
|---------|--------|---------|
| Decision Gate | ✅ Implemented | 15-second countdown decision screen with Pass / Lock It In |
| Lock Status Screen | ✅ Implemented | Shows match lock status, partner info |
| Calendar Sync | ✅ Implemented | Screen for syncing availability |
| Venue Selector | ✅ Implemented | Category-based venue browsing (cafe, bar, lounge, restaurant) |
| Reservation Locker | ✅ Implemented | Venue booking/reservation management |

---

## 9. Preferences

| Feature | Status | Details |
|---------|--------|---------|
| Filter Constraints | ✅ Implemented | Age range, max distance, preferred genders |
| Value Matrix | ✅ Implemented | 6 dimensions: ambition, social, adventure, tradition, intellect, emotional (0-1) |
| Priority Weighting | ✅ Implemented | Age, distance, values, interests weight sliders |
| Communication Cadence | ✅ Implemented | Direct vs playful vs deep communication style preferences |

---

## 10. Wallet / Premium

| Feature | Status | Details |
|---------|--------|---------|
| Token Vault | ✅ Implemented | Token balance display |
| Profile Ledger | ✅ Implemented | Transaction history |
| Premium Subscriptions | ✅ Implemented | Google Pay integration, ₹149 Premium monthly (cards + UPI Autopay mandate) |
| Swipe Allowance Upgrades | ✅ Implemented | Premium = 99999 swipes (effectively unlimited), Infinite = unlimited |
| Fast Passes & Rain Checks | ✅ Implemented | Token-based boosts for matching priority |

---

## 11. Viral / Social

| Feature | Status | Details |
|---------|--------|---------|
| Duo Crew (Wingman) | ✅ Implemented | Invite codes, wingman system for double dates |
| Double Date | ✅ Implemented | 4-person date room |
| Heat Map | ✅ Implemented | Location-based activity visualization |

---

## 12. User Profiles

| Feature | Status | Details |
|---------|--------|--------|
| Profile Photos | ✅ Implemented | Primary photo, order, thumbnails |
| Interest Tags | ✅ Implemented | Emoji + name + category |
| Bio, Occupation, Education | ✅ Implemented | Displayed on swipe cards |
| Verification Badge | ✅ Implemented | Checkmark on verified profiles |

---

## 14. Free KYC Face Verification Pipeline

| Feature | Status | Details |
|---------|--------|--------|
| Document Face Match Endpoint | ✅ Implemented | `POST /verify-document-face` on pose-service — extracts face from ID image, compares against profile photos via MediaPipe landmark descriptors + cosine similarity |
| PDF-to-Image Conversion | ✅ Implemented | PyMuPDF renders first page at 200 DPI → OpenCV frame → face extraction; non-PDF images decoded directly |
| Trigger Endpoint (api-core) | ✅ Implemented | `POST /kyc/verify-face` — fetches latest KYC doc from MinIO (S3 GetObject), gets profile photo URLs, sends to pose-service, updates kyc_status='verified' on match |
| Mobile API Method | ✅ Implemented | `verifyKycFace()` in api.ts → POST /api/v1/kyc/verify-face with proper TypeScript typing |
| Face Verify Button in KYC Screen | ✅ Implemented | Appears after successful document upload; shows verifying/matched/no_match/error states with retry |
| KYC Verification in Profile Settings | ✅ Implemented | "KYC Verification" row in ProfileLedgerScreen settings card with color-coded status badge |
| Settings vs Onboarding Navigation | ✅ Implemented | KYCScreen checks `route.name === 'KYCVerify'` to branch between onboarding reset vs settings goBack |
| Status Badge Refresh on Focus | ✅ Implemented | Focus listener refetches KYC status when returning from KYC screen |

### Architecture

```
Mobile (KYCScreen)                  API Core                        Pose Service
      │                                │                               │
      │  POST /kyc/verify-face          │                               │
      ├────────────────────────────────►│                               │
      │                                 │                               │
      │                          1. Fetch doc from MinIO               │
      │                             (GetObjectCommand)                 │
      │                          2. Get profile photo URLs             │
      │                          3. POST /verify-document-face         │
      │                                 ├──────────────────────────────►│
      │                                 │                               │
      │                                 │                    1. Decode image (JPEG/PNG)
      │                                 │                       or render PDF page
      │                                 │                    2. Extract face descriptor
      │                                 │                       via MediaPipe FaceMesh
      │                                 │                    3. Compare vs profile photo
      │                                 │                       descriptors (cosine sim)
      │                                 │                    4. Return match + confidence
      │                                 │◄──────────────────────────────────┤
      │                                 │                               │
      │                          4. If match=true:                     │
      │                             - UPDATE users SET kyc_status='verified'
      │                             - UPDATE kyc_documents SET status='verified'
      │                                 │                               │
      │◄────────────────────────────────┤                               │
      │                                 │                               │
```

### Key Design Decisions

1. **Free / No Paid SDK**: Uses existing in-house MediaPipe pipeline — no Persona/FaceTec/Signzy costs
2. **PDF Support**: PyMuPDF renders the first page of government IDs as images at 200 DPI; OpenCV then runs face detection on the rendered image
3. **Matching Threshold**: 0.55 (lower than the 0.65 for selfie-vs-photo matching) — document photos vary in quality (lighting, angle, age of ID)
4. **Scoring**: Best-of-N blend (`best_score * 0.7 + avg_score * 0.3`) — takes the highest match while smoothing with average for robustness
5. **Optional Step**: KYC can be skipped during onboarding and completed later from Profile → Settings → KYC Verification
6. **Double Delivery Fix**: Chat messages now delivered exclusively via Redis pub/sub (api-core → Redis → ChatHandler → match room) instead of both socket broadcast AND Redis pub/sub
7. **/respond Name Fix**: The `match:created` event bus message now correctly includes the responder's name/photo as `userBName`/`userBPhotoUrl` instead of duplicating the original liker's

---

## 15. Backend Services & Infrastructure

| Feature | Status | Details |
|---------|--------|---------|
| PostgreSQL Database | ✅ Implemented | Tables: users, matches, messages, user_interactions, profile_photos, interests, push_tokens, etc. |
| Redis Caching | ✅ Implemented | Session, presence, rate limits, swipe counts, H3 queues |
| Redis Event Bus | ✅ Implemented | Event-driven architecture via dedicated Redis pub/sub instance (`redis-events:6380`) — replaces Kafka |
| Python Match Engine | ✅ Implemented | Hyperlocal spatial (H3) matching with Celery workers |
| Face Service (pose-service) | ✅ Implemented | KYC document ↔ profile photo face matching only; selfie verification moved on-device |
| H3 Geospatial Indexing | ✅ Implemented | Uber H3 hexagonal grid for location-based matching |
| Docker Compose Setup | ✅ Implemented | All services containerized with nginx ingress |
| Graceful Shutdown | ✅ Implemented | SIGTERM/SIGINT handlers for all services |

---

## 14. Specific Answers to Your Questions

### ✅ "Is the chat inbox after a mutual match working?"

**Yes — the full chat pipeline is implemented end-to-end:**

1. **Mutual match detected** when User A likes User B and User B has already liked User A (or vice versa)
2. A `match` record is created in PostgreSQL (`matches` table)
3. Both interactions are marked `is_mutual = TRUE` with `responded_at = NOW()`
4. A `match:created` event is published to the `event:match` channel on the Redis event bus
5. The real-time service consumes this and emits `match:new` to both users' rooms on both `/presence` and `/chat` namespaces
6. Conversations appear immediately in the **ChatListScreen** (fetched from `GET /matches/conversations`)
7. Users can tap a conversation → **ChatScreen** with real-time messaging
8. Messages are delivered via Socket.IO with Redis pub/sub for cross-instance support
9. New messages trigger push notifications to the partner

> The `ChatListScreen` has a nice empty state: "No Conversations — Match with someone to start chatting" with a "Discover People" button.

### ✅ "Does swiping right push a notification to the user who was swiped?"

**Yes — a full push notification pipeline is implemented:**

When User A swipes right on User B, the backend in `POST /matches/swipe` does the following:

1. Records the interaction in `user_interactions` table
2. **Sends an Expo push notification** via `notificationEvents.newLike(targetUserId, swiperName)`:
   - Title: `"New Like 💘"`
   - Body: `"{swiperName} liked your profile! See who likes you."`
   - Data payload includes: `{ type: 'new.like', screen: 'Likes' }`
3. **Publishes an event bus message** on the `event:match` channel
4. The real-time service consumes the event and emits `likes:new` to the target user's personal room on both `/presence` and `/chat` namespaces
5. The target user's app receives this via Socket.IO and **increments the unread like badge count**

> The push notification respects user preferences — if push is disabled, the notification is skipped but the real-time badge still updates.

---

## 16. 1:1 Voice/Video Calls (WebRTC / LiveKit)

| Feature | Status | Details |
|---------|--------|---------|
| LiveKit SFU (WebRTC) | ✅ Implemented | `livekit-server` container (dev) or **LiveKit Cloud** (prod) — SFU handles ICE, TURN and media routing; no raw P2P |
| Call Token Endpoint | ✅ Implemented | `POST /api/v1/matches/:matchId/call/token` — JWT + active-match participant check, room-scoped token (`match:<id>`, canPublish/canSubscribe, 4h TTL) |
| wss-aware Client URL | ✅ Implemented | Token response mirrors the inbound scheme (`X-Forwarded-Proto` / `request.protocol`): `wss://` over TLS, `ws://` on LAN dev; `LIVEKIT_PUBLIC_URL` overrides |
| 1:1 Call Signaling | ✅ Implemented | `call:invite/accept/decline/cancel/busy` over the shared `/chat` socket → Redis pub/sub → callee's personal room (`user:<id>`) — rings on any screen |
| Busy Handling | ✅ Implemented | `call:active_join/leave` per socket; busy cleared only when the last in-call socket disconnects; second caller gets `call:busy` |
| Incoming-Call Overlay | ✅ Implemented | Global accept/decline sheet (45s ring timeout) rendered in RootNavigator — works on any screen |
| Call Screen | ✅ Implemented | Caller ringing → connecting → active; mic mute, camera toggle, duration timer, local PiP, remote fullscreen, partner-left; declined/no-answer/busy/error states |
| Match-Room Security | ✅ Implemented | `chat:join` validates match membership against Postgres (active match + participant) — closes chat eavesdropping + unsolicited rings; fails open on DB errors |
| Expo Go Degradation | ✅ Implemented | `registerGlobals()` guarded + lazy `VideoView` — app boots in Expo Go with calls disabled instead of crashing |
| WebRTC Dependencies | ✅ Implemented | LiveKit v2 stack only: `@livekit/react-native`, fork `@livekit/react-native-webrtc`, `@livekit/react-native-expo-plugin`, `livekit-client`; upstream `react-native-webrtc` removed (duplicate native module) |
| iOS ATS for LAN dev | ✅ Implemented | `NSAllowsLocalNetworking: true` — permits `ws://` to LAN IPs in dev, ATS stays strict elsewhere (App-Store-safe) |
| TURN (self-hosted) | ⚠️ Config-ready | Embedded LiveKit TURN off by default (needs CA-signed cert); enable via `LIVEKIT_TURN_*` env + certs in `config/certs/`. LiveKit Cloud Build plan includes TURN |

### Architecture

```
Phone A (Caller)                     Phone B (Callee)
    │  POST /matches/:id/call/token      │
    ├──────────────► api-core ◄──────────┤  (JWT + match-participant check → LiveKit token)
    │                                    │
    │  ws/wss://<livekit>  +  token      │  ws/wss://<livekit>  +  token
    ├──────────────► LiveKit SFU ◄───────┤  (signaling + media via ICE/TURN)
    │                                    │
    │  call:invite (via /chat socket)    │
    ├──────────────► realtime ◄──────────┤
    │   Redis pub/sub → user:<B> room    │
    │                                    │
    │◄────────────── call:accept ────────┤
    │◄──────────── media flows ─────────►│
```

### Key Design Decisions

1. **SFU over raw P2P** — LiveKit (not `RTCPeerConnection` directly): TURN/ICE/reconnection handled by the SFU; no TURN-less P2P failures
2. **Security boundary at the token endpoint** — participants verified against `matches` before a room-scoped token is issued; rooms namespaced `match:<id>`
3. **Signaling decoupled from media** — Redis pub/sub → personal rooms means invites land on any screen; busy is server-enforced
4. **DB-backed room join** — `chat:join` now validates membership (previously any authenticated user could join any match room and eavesdrop); fails open so a DB blip never breaks chat
5. **Expo Go first** — the WebRTC native module only exists in dev/production builds; guarded globals + lazy views keep the app bootable everywhere

### ⚠️ Caveats

1. **No push-notification fallback for call invites** — a ring is delivered only over a live socket. If the callee's app is backgrounded/offline (or the realtime service is asleep on free hosting), the invite is never delivered and the caller gets "No answer" after 45s. Push infrastructure exists but isn't wired to `call:invite` — **the #1 production reliability gap.**
2. **Expo Go doesn't support calls** — native WebRTC module absent; use dev builds (`expo run:android` / `expo run:ios` or a dev client)
3. **Free-tier limits** — LiveKit Cloud Build: 5,000 WebRTC minutes/month + 50 GB downstream; fine for alpha, burns fast with real usage
4. **Free-tier sleep latency** — Render (~15 min), Koyeb (~1 h), Neon (~5 min) idle sleeps; the first call after idle is slow, and a sleeping realtime drops rings
5. **TURN off by default** — fine on LAN; strict NATs/corporate firewalls need TURN enabled (CA-signed cert; `LIVEKIT_TURN_TLS_PORT=443` without a load balancer)
6. **ws:// vs wss://** — dev LAN uses `ws://` (iOS covered by `NSAllowsLocalNetworking`); production must set `LIVEKIT_PUBLIC_URL=wss://<project>.livekit.cloud`
7. **Docker LAN media** — the LiveKit container advertises its internal bridge IP; set `LIVEKIT_RTC_NODE_IP=<host LAN IP>` or the call connects with no media. Windows firewall must also allow TCP 7880/7881, UDP 7882, UDP 50000–60000
8. **Single-invite overlay** — two simultaneous invites overwrite each other; the first caller rings to timeout
9. **Busy state is per-instance in-memory** — relies on nginx `ip_hash` sticky sessions when scaling horizontally
10. **Call token TTL 4h** — longer than a call needs; harmless given room-scoping, reduce if paranoid

---

## 16. Scalability Patterns — [Follow this pattern while development]

These patterns were applied (commit `8619043`) so a single backend instance handles maximum users. Any new feature touching sockets, chat events, or list endpoints MUST follow them — regressing any of these multiplies per-user server cost.

### A. One shared socket per namespace (client)
- The app holds exactly **two** session-long connections: `/chat` via `getChatSocket()` (`services/callSocket.ts`) and `/presence` via `getPresenceSocket()` (`services/presenceSocket.ts`). `/vibe-check` (`services/vibeSocket.ts`) connects only during the vibe flow.
- **Never call `io(...)` from a screen or store.** Get the shared socket, attach *named* handlers, and detach exactly those handlers on unmount:
  ```ts
  const socket = getChatSocket();
  const onEvent = (data) => { ... };
  socket.on('event', onEvent);
  if (socket.connected) runConnectLogic();   // 'connect' won't re-fire on an already-live socket
  socket.on('connect', runConnectLogic);     // and must re-run after every reconnect
  return () => { socket.off('event', onEvent); socket.off('connect', runConnectLogic); };
  ```
- **Never `disconnect()` a shared socket from a screen** — only `closeCallSocket()` / `closePresenceSocket()` at logout tear them down.
- **Never emit `chat:leave` on screen unmount** — the unread badge and chat list rely on room membership persisting on the shared socket.
- Singletons recreate the socket only when `!socket || !socket.active` (`disconnected` is true mid-auto-reconnect; recreating then orphans other screens' listeners). On reuse, refresh `socket.auth` with the current token.
- Client event handlers must guard by scope (`if (data?.matchId !== matchId) return;`) because the shared socket receives events for every joined room.

### B. Throttle high-frequency client emits
- `chat:typing` sends "typing" at most once per 2.5s (`ChatScreen.handleInputChange`); the trailing stop after 2s idle is what clears the partner's indicator. Any future per-keystroke/per-gesture signal must be throttled the same way — each emit fans out through Redis + every room socket.

### C. No N+1 queries on list endpoints (api-core)
- Fetch children for a whole page with one `WHERE x = ANY($1)` query and group in JS (see `/matches/profiles`, `routes/matches.ts`). Never query per row inside a `map`/loop.

### D. Random selection: sample first, full scan as fallback
- `/matches/profiles` tries `(SELECT * FROM users TABLESAMPLE SYSTEM (10))` and re-runs the original `ORDER BY RANDOM()` query only if the sample yields < 20 rows. The fallback guarantees behavior is identical to the unsampled query — keep that guarantee if the numbers change.

### E. Local-only room broadcast (realtime)
- Events arriving from Redis pub/sub (published by api-core) must be emitted with `nsp.local.to(room).emit(...)` — the `local` flag skips the Redis-adapter relay (prevents cross-instance double delivery) and costs O(room members).
- **Never** iterate `nsp.sockets` to deliver events (O(all sockets) per event), and **never** use plain `nsp.to(room).emit()` from a Redis-subscriber handler (double delivery when scaled).
- Exclude a sender across all their devices with `.except('user:<senderId>')` — every socket joins its personal `user:<id>` room on connect.

### F. Chat message payload (wire contract)
- Broadcast payload stays minimal and complete: `{ id, matchId, senderId, content, createdAt, media? }`. `matchId` routes, `senderId` distinguishes own/partner, `id` dedupes, `createdAt` orders. Don't add fields clients don't need; never remove one of these.
