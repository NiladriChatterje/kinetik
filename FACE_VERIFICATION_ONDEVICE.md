# On-Device Face Verification — Design Doc

**Status:** Implemented
**Date:** 2026-08-21 (renamed from pose/liveness vocabulary 2026-08-29)
**Decision:** Move selfie face verification fully on-device. The verification result is
self-reported to the server (accepted trade-off — the verified badge is a UX signal, not a
security guarantee).

## 0. What this check is, and is not

It confirms that the selfie shows **the same person as the profile photos the user
uploaded**. That is the whole feature — the point is that the uploaded photos are
genuinely of the account holder.

It is **not**:

- a liveness check — nothing asks the user to blink, turn, or follow a motion path
- an anti-spoofing check — a printed photo of the right person passes
- a pose challenge — the head-angle limits in `faceVerification.ts` reject a selfie
  that is too turned to embed reliably; they are an image-quality guard, not a
  pose the user must hit

Liveness heuristics and head-pose estimation existed in the original server-side
service and were deleted in this rework (§5). The naming lagged behind until
migration 019 and the rename described in §7.

---

## 1. Problem

The previous flow was server-dependent:

```
Mobile (expo-camera selfie)
   → api-core POST /users/pose-verification  (multipart upload)
      → pose-service /verify-face-match       (Python FastAPI + MediaPipe + OpenCV)
         → fetches profile photos from MinIO
         → landmark-geometry cosine similarity
      → UPDATE users SET is_verified, liveness_status
```

Problems:
- Requires the `pose-service` container + MinIO round-trips for a check that only affects a badge.
- The landmark-geometry "face match" (normalized landmark offsets + cosine similarity) is weak
  at distinguishing identities — a trained face-embedding model is strictly better.
- Network round-trip means no instant feedback; failures were silently swallowed
  (`pose-service down → user proceeds unverified`).

## 2. Goal

- Run face detection, the image-quality gate, and selfie ↔ profile-photo matching **entirely on the device**.
- Server receives only a self-reported flag: `POST /users/face-verification { verified, confidence }`.
- Minimal diff; remove all dead server-side pose/liveness code **without breaking KYC**
  (KYC document face-match still uses pose-service `/verify-document-face`).

## 3. SDK research (verified 2026-08-21 against npm registry)

| Package | Version | Role | Notes |
|---|---|---|---|
| `@react-native-ml-kit/face-detection` | **2.0.1** | Face detection on static image URIs | Google ML Kit wrapper. `detect(uri, opts) → Face[]` with `frame {left,top,width,height}` and head Euler angles `rotationX` (pitch), `rotationY` (yaw), `rotationZ` (roll). Classic native module — works on RN 0.86 new architecture via the interop layer. No config plugin needed (plain autolink + pod install via `expo prebuild`). |
| `react-native-fast-tflite` | **3.0.1** (Apr 2026) | Runs the face-embedding TFLite model | v3 is built on **Nitro Modules** → requires `react-native-nitro-modules` peer dep. v3 API: `loadTensorflowModel(source, delegates: [])`; inputs/outputs are **`ArrayBuffer[]`** (v2 used TypedArrays). Has an Expo config plugin (`"react-native-fast-tflite"` in `app.json` plugins). Metro must treat `.tflite` as an asset ext. |
| `react-native-nitro-modules` | **0.37.0** | Peer dep of fast-tflite v3 | — |
| `jpeg-js` | **0.4.4** | Pure-JS JPEG decode → raw RGBA pixels | RN has no canvas; this is the standard way to get pixel data from a small crop. Decoding a 112×112 JPEG is sub-millisecond. |
| Model: `mobile_face_net.tflite` | 5.24 MB | Face-recognition embedding | MobileFaceNet. Input `[1,112,112,3]` float32, normalized `(px − 127.5) / 127.5`; output `[1,192]` float32 embedding. Bundled at `packages/mobile/src/assets/models/`. |

Environment constraints checked:
- Expo SDK 57 / RN 0.86.2, `expo-dev-client` already present → custom native modules are fine
  (this will NOT run in Expo Go; a new dev-client / EAS build is required after this change).
- `expo-file-system` new API provides `File.bytes(): Promise<Uint8Array>` (SDK 54+) — used to read
  the cropped JPEG without base64 gymnastics. Existing code keeps using `expo-file-system/legacy`.

## 4. On-device pipeline

```
FaceVerificationScreen (mount)
  api.getPhotos() → profile photo URLs (server copies; local URIs may be gone on resume)
  download each to cacheDirectory (legacy FileSystem.downloadAsync)
  embedFace(uri) per photo  ──────────────┐
                                          │  embedFace(uri):
Capture selfie (expo-camera, unchanged)   │    1. MLKit detect(uri, {performanceMode:'accurate'})
  embedFace(selfieUri) + quality gate:    │    2. take largest face; expand box 25%; clamp to image
    - exactly 1 face                      │    3. ImageManipulator crop + resize 112×112 → JPEG
    - |rotationY| ≤ 30° (yaw)             │    4. File.bytes() → jpeg-js decode → RGBA
    - |rotationX| ≤ 25° (pitch)           │    5. Float32Array[1·112·112·3], (px−127.5)/127.5
                                          │    6. tflite.run([buffer]) → Float32Array(192)
Cosine similarity selfie ↔ each profile   │    7. L2-normalize
  confidence = 0.7·best + 0.3·avg  ───────┘
  verified = (≥2 profile photos had faces) && confidence ≥ 0.55

api.reportFaceVerification({ verified, confidence })   // self-report, JSON
```

Thresholds: yaw/pitch limits match the old server config (30°/25°). The cosine threshold for
MobileFaceNet embeddings is **0.55** (typical same-person cosine ≥ 0.6; different-person ≤ 0.4).
The ≥2-photos-with-faces rule is carried over from the server implementation.

Failure behavior is unchanged by design: verification never blocks onboarding. If the model
fails to load, no face is found, or the match fails, the user continues unverified.

## 5. Server changes

### api-core `POST /api/v1/users/face-verification` (slimmed)
- Was: multipart selfie upload → pose-service call → DB update. `POSE_VERIFICATION_BYPASS` env flag.
- Now: JWT-protected JSON body `{ verified: boolean, confidence?: number }`.
  - `verified: true` → `UPDATE users SET is_verified = TRUE, face_verification_status = 'verified'`
  - `verified: false` → logged only (status untouched, same as before)
- `POSE_VERIFICATION_BYPASS` removed (meaningless now — the client is the verifier).

### pose-service (kept, but KYC-only)
`/verify-document-face` is still used by `routes/kyc.ts` (government-ID face vs profile photos),
so the service and its MediaPipe FaceLandmarker stay. Removed as dead code:
- `POST /verify` (liveness endpoint — nothing called it anymore)
- `POST /verify-face-match` (selfie matching — replaced by on-device)
- `verifier.verify()`, liveness heuristics, solvePnP head-pose estimation,
  `VerificationStatus`/`VerificationResult`, `_update_liveness_status`
- The **asyncpg / PostgreSQL dependency entirely** — the only DB write was liveness status.
  `DATABASE_URL` removed from config and docker-compose.

### Database
- `users.pose_photo_url` was write-only dead weight (only ever set to NULL) →
  migration `014_drop_pose_photo_url.sql`, removed from `init-db.sql` and `auth.ts`.
- `users.liveness_status` stayed at first (read by profile queries; still set by the new
  endpoint), then became `users.face_verification_status` — see §7.

## 6. Files touched

| File | Change |
|---|---|
| `packages/mobile/package.json` | + 4 deps (table above) |
| `packages/mobile/app.json` | + `react-native-fast-tflite` plugin |
| `packages/mobile/metro.config.js` | + `tflite` asset extension |
| `packages/mobile/src/assets/models/mobile_face_net.tflite` | new (bundled model) |
| `packages/mobile/src/services/faceVerification.ts` | new — the whole pipeline in §4 |
| `packages/mobile/src/screens/onboarding/FaceVerificationScreen.tsx` | on-device verify + self-report |
| `packages/mobile/src/services/api.ts` | `submitPoseVerification` (multipart) → `reportPoseVerification` (JSON) |
| `packages/api-core/src/routes/faceVerification.ts` | slim self-report route |
| `packages/api-core/src/routes/auth.ts` | drop `pose_photo_url` reference |
| `packages/pose-service/src/main.py` | remove selfie endpoints + asyncpg |
| `packages/pose-service/src/verifier.py` | remove liveness/pose-estimation code |
| `packages/pose-service/src/config.py` | remove DB URL + liveness thresholds |
| `packages/pose-service/pyproject.toml` | remove asyncpg |
| `docker-compose.yml` | drop `POSE_VERIFICATION_BYPASS`, pose-service `DATABASE_URL` + postgres dependency |
| `.env.example` | drop `POSE_VERIFICATION_BYPASS` |
| `scripts/init-db.sql`, `scripts/migrations/014_drop_pose_photo_url.sql` | drop dead column |

## 7. Rename: pose/liveness → face (2026-08-29)

The rework above deleted the liveness and pose-estimation code but kept the old names,
so the codebase still described a feature that no longer existed. Renamed throughout:

| Was | Now |
|---|---|
| `PoseVerificationScreen.tsx` | `FaceVerificationScreen.tsx` |
| nav route `PoseVerification` | `FaceVerification` |
| `POST /api/v1/users/pose-verification` | `POST /api/v1/users/face-verification` |
| `routes/poseVerification.ts` / `poseVerificationRoutes` | `routes/faceVerification.ts` / `faceVerificationRoutes` |
| `api.reportPoseVerification()` | `api.reportFaceVerification()` |
| `PRODUCTION_POSE` / `EXPO_PUBLIC_PRODUCTION_POSE` | `PRODUCTION_FACE_VERIFICATION` / `EXPO_PUBLIC_PRODUCTION_FACE_VERIFICATION` |
| `extra.productionPose` | `extra.productionFaceVerification` |
| `users.liveness_status` | `users.face_verification_status` |
| onboarding step `'pose'` | `'face'` |

Database side is migration `019_rename_liveness_to_face_verification.sql`, guarded so it
can be re-run. `OTPVerifyScreen` still maps a legacy `'pose'` step to the same screen, so
a row written before the migration does not dead-end mid-onboarding.

`packages/pose-service` keeps its name for now — it no longer touches selfies at all and
serves only the KYC document face match (§5), and it is commented out of `docker-compose.yml`.

## 8. Risks / accepted trade-offs

1. **Self-reported flag is forgeable** — anyone with a JWT can POST `verified: true`.
   Explicitly accepted; the badge is cosmetic.
2. **`@react-native-ml-kit/face-detection` is a legacy-arch module** running through RN's
   new-arch interop layer. This is the officially supported compat path and works on RN 0.86;
   if it ever breaks, `@infinitered/react-native-mlkit-face-detection` (Expo Modules API) is the
   drop-in fallback.
3. **App size** +≈5.5 MB (model + ML Kit native libs).
4. **A new native build is required** (`expo prebuild` / EAS build) — JS-only OTA updates cannot
   ship this change.
5. Profile photos are WebP; ML Kit and ImageManipulator decode WebP on Android and iOS 14+ —
   below the app's minimum OS versions, so no issue.
