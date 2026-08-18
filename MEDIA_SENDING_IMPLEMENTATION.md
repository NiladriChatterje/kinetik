# Media Sending Implementation (Audio & Images)

Reference doc for how voice notes and chat images are sent, stored, and played back.
If one of these features breaks, start here — the pipeline, the known failure modes,
and a diagnostic playbook are documented below.

**Scope:** chat media only (voice notes + chat images/videos/files). Profile photos
and KYC/pose photos use `savePhoto` too but are not covered here beyond the storage
layer they share.

---

## 1. Architecture at a glance

```
┌─ Mobile (expo) ──────────────────────────────────────────────────┐
│  record / pick  →  normalize  →  FileSystem.uploadAsync (multipart) │
│  play: createAudioPlayer(proxyUrl?token=...)                       │
└──────────────┬───────────────────────────────────────────────────┘
               │ HTTPS multipart (JWT Bearer)
┌──────────────▼───────────────────────────────────────────────────┐
│  api-core (Fastify)                                                │
│  POST /api/v1/matches/conversations/:id/media                      │
│    image → savePhoto          → MinIO  {userId}/{id}.webp  (public)│
│    audio → saveEncryptedChatFile → MinIO  chat/{userId}/{id}.enc   │
│  GET  /api/v1/matches/media/*  (proxy: decrypt-on-the-fly, ranges) │
└───────────────────────────────────────────────────────────────────┘
```

Key files:

| Concern | File |
|---|---|
| Recording, upload, playback UI | `packages/mobile/src/screens/match/ChatScreen.tsx` |
| Media upload (native multipart) | `packages/mobile/src/services/api.ts` → `sendMediaMessage()` |
| Image compression | `packages/mobile/src/services/photoService.ts` → `compressPhoto()` |
| Media endpoints + proxy | `packages/api-core/src/routes/matches.ts` |
| MinIO storage + encryption | `packages/api-core/src/services/photoStorage.ts` |
| Buffer AES-GCM crypto | `packages/shared/src/utils/fileCrypto.ts` |
| URL resolution (relative → absolute) | `packages/mobile/src/config.ts` → `resolveUrl()` |

---

## 2. Audio pipeline (voice notes)

### 2.1 Record (mobile)

- `useAudioRecorder(RecordingPresets.HIGH_QUALITY)` (expo-audio `~57.0.3`).
  Correct SDK 57 usage is `prepareToRecordAsync()` then `record()` — matches the
  expo-audio docs exactly.
- Mic is press-and-hold. Before recording: `setAudioModeAsync({ allowsRecording: true,
  playsInSilentMode: true })`. After stop: `setAudioModeAsync({ allowsRecording: false,
  playsInSilentMode: true })` — leaving recording mode on routes playback to the
  earpiece / mutes it under the iOS silent switch.
- Lifecycle guards in `ChatScreen.tsx` (`micPressActiveRef`, `startTaskRef`,
  `isRecordingActiveRef`) serialize start/stop so a quick tap can't orphan a live
  native recording session.

### 2.2 Android zero-byte URI bug (known upstream issue)

Expo issue [#39646](https://github.com/expo/expo/issues/39646): on Android,
`recorder.uri` can point to a **0-byte file** while the real recording is written to a
sibling file in `cacheDirectory + "Audio/"`. The code defends against this:
- After `stop()`, check `FileSystem.getInfoAsync(recorder.uri)`.
- If missing/empty, list `cache/Audio/` and pick the newest non-empty file.

This guard is defensive — the upstream bug is fixed in later SDKs, but keeping it is
harmless and protects against regressions.

### 2.3 Android file copy (⚠ THE bug that shipped as "File not found")

Why a copy at all: `FileSystem.uploadAsync` uses `FileInputStream` on Android 10+,
which cannot read files written by expo-audio in its sandbox. The code therefore reads
the recording and writes a fresh copy to the app cache (`voice_{ts}.m4a`) before upload.

**What was wrong (fixed in commit 2646a46):**
The copy read the file with `fetch(uploadSourceUri)`:

```js
const response = await fetch(uploadSourceUri);   // file:// URI
const arrayBuffer = await response.arrayBuffer(); // ← BUG
```

`fetch()` does **not** support `file://` URIs on Android. Instead of throwing, it
**resolves with an error body** containing the text `"File not found"`. That 14-byte
string was base64-encoded and uploaded as the "voice note". Symptom: the message sends
and appears in chat, but is completely inaudible — no player can play 14 bytes of text.
The empty-file guard did not catch it (14 > 0 bytes).

**The fix:** read through the native filesystem instead:

```js
const base64Content = await FileSystem.readAsStringAsync(uploadSourceUri, {
  encoding: FileSystem.EncodingType.Base64,
});
if (!base64Content) throw new Error('Read produced empty content');
```

Rule for future changes: **never use `fetch()` to read local `file://` URIs on
Android.** Use `FileSystem.readAsStringAsync` / `getInfoAsync` / `uploadAsync`, which
go through the native filesystem. If you must fetch, check `response.ok` and validate
the body size before using it.

### 2.4 Upload (mobile)

`api.sendMediaMessage()` → `FileSystem.uploadAsync` (native OkHttp multipart) with
`fieldName: 'file'`, `mimeType: 'audio/mp4'`, query `media_type=audio`, JWT Bearer
header. Native multipart deliberately avoids React Native's broken JS `FormData`
polyfill ("Unsupported FormDataPart implementation").

### 2.5 Store (server)

`POST /conversations/:id/media` (matches.ts) → `saveEncryptedChatFile()`:

- Encrypt with AES-256-GCM (`shared/src/utils/fileCrypto.ts`): output layout is
  `iv (12 bytes) + authTag (16 bytes) + ciphertext`. If `MESSAGE_ENCRYPTION_KEY` is
  empty the buffer passes through unmodified (dev mode).
- Store in MinIO at `chat/{userId}/{fileId}.enc` (always `.enc`, Content-Type hidden).
- Return URL: `/api/v1/matches/media/chat/{userId}/{fileId}.enc?ext=m4a`.
  The `ext` maps back to a real Content-Type at serve time (`m4a` → `audio/mp4`) —
  native players use it to pick a decoder.

Encryption key note: `MESSAGE_ENCRYPTION_KEY` is defaulted in `docker-compose.yml`
(`kinetik_msg_enc_key_2024_dev`). Encrypt/decrypt must use the **same key**; a changed
key makes old recordings undecryptable.

### 2.6 Serve (proxy)

`GET /media/*` (matches.ts):
- **Skips the JWT preHandler** — native players can't send headers, so the token is
  passed as `?token=<jwt>` and verified manually. Membership check: requester must be
  the owner or matched with the owner.
- Reads the MinIO object, decrypts on the fly, streams with the mapped Content-Type.
- Supports byte ranges (`206 Partial Content`) — AVPlayer/ExoPlayer require them.

### 2.7 Playback (mobile)

`togglePlayAudio()` in ChatScreen.tsx:
- Build URL: `resolveUrl(media.url) + "&token=" + api.getToken()`.
- `setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true })` first
  (see 2.1 — prevents earpiece routing / silent-switch muting).
- `createAudioPlayer(url)` → `player.play()`. Players must be `remove()`d when done
  (`discardPlayer()`) or the native instance leaks.
- Status listener handles `didJustFinish` (cleanup) and — added in commit 2646a46 —
  **`status.error`** (Alert + reset). Without the error branch, a failed load left the
  bubble stuck in a silent "playing" state with zero feedback.

---

## 3. Image pipeline (chat images)

### 3.1 Pick & compress (mobile)

- Pick via `expo-image-picker` (gallery/camera) → `compressPhoto()`:
  strip EXIF → resize to max 1200px longest edge → WebP `quality 0.85`.
- Client-side compression was added (commit 646210f) to fix **502s**: full-resolution
  camera photos exceeded nginx's 10 MB body limit / 60 s timeout.
- Upload identical to audio: `FileSystem.uploadAsync` multipart, `mimeType: 'image/webp'`,
  `media_type=image`.

### 3.2 Store & serve (server)

`POST /conversations/:id/media` → `savePhoto()`:
- Full-res: sharp → lossy WebP `{ quality: 82, effort: 4 }` (chat passes
  `{ lossless: false }` — lossless effort-6 on big photos blows the 60 s timeout).
- Thumbnail: 300 px lossy WebP. BlurHash for previews.
- Stored **unencrypted** at `{userId}/{photoId}.webp`, served directly as a public
  URL (`/uploads/...`), resolved on the client via `resolveUrl()`.

---

## 4. Diagnostic playbook (how to debug a "sent but broken" media message)

Worked example from the real audio bug — reproduce these steps in order:

1. **Check what the server actually received.** Query the DB — `file_size` is the
   strongest signal:

   ```sql
   SELECT cm.id, cm.media_type, cm.file_size, cm.url, cm.created_at
   FROM chat_media cm ORDER BY cm.created_at DESC LIMIT 20;
   ```

   A real voice note is tens of KB. A tiny value (e.g. 14) means garbage was uploaded —
   the bug is in the client read/upload path, **not** playback.

2. **Pull the stored object and decrypt it.** The stored size is plaintext + 28
   (12 IV + 16 GCM tag). Retrieve from MinIO (`kinetik-photos` bucket,
   `minioadmin`/`minioadmin` at `localhost:9000` by default), then decrypt with
   `deriveKey(MESSAGE_ENCRYPTION_KEY)` and dump hex/ascii. The real bug surfaced as
   the ASCII string `File not found` — an error body that got uploaded as audio.

3. **If the plaintext is valid media**, the problem is downstream: verify the proxy
   with a manual request including `?token=<jwt>` and a `Range: bytes=0-1` header;
   check the mobile `[ChatAudio]` console logs; check the player's `status.error`.

4. **If `file_size` is 0**, the send should have been rejected server-side
   (`EMPTY_FILE` guard) — investigate the client copy step, not the server.

## 5. Common failure checklist

| Symptom | Likely cause | Fix reference |
|---|---|---|
| Audio sends but is silent, tiny `file_size` | Client read the file with `fetch()` / read garbage | §2.3 — use `readAsStringAsync` |
| Audio sends, playback error alert | Corrupt bytes, proxy auth, or codec mismatch | §4 steps 1–3 |
| No sound, no error, stuck "playing" | Player error ignored | §2.7 — handle `status.error` |
| Playback silent under iOS silent switch | Stale recording audio mode | §2.1 / §2.7 — `playsInSilentMode` |
| Image upload 502 | Uncompressed camera photo, body/timeout limits | §3.1 — client compression |
| Old recordings stop decrypting | `MESSAGE_ENCRYPTION_KEY` changed | §2.5 |

---

[audio and image sending fix over]
