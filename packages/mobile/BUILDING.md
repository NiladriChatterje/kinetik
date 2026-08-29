# Building the Kinetik mobile app

Build-time configuration lives in [`app.config.ts`](./app.config.ts), which layers
environment-specific values over the static parts in `app.json`. Everything it
produces is frozen into the binary — changing any of it needs a **rebuild**, not
an app restart.

## Environments

Selected with `APP_ENV`. EAS sets it per build profile in `eas.json`.

| | `development` | `preview` | `production` |
|---|---|---|---|
| `EXPO_PUBLIC_API_URL` | optional, defaults to the LAN dev box | **required** | **required**, must be `https://` |
| Cleartext HTTP (Android) | allowed | allowed if the URL is `http://` | **blocked** |
| iOS `NSAllowsLocalNetworking` | on | on | removed |
| Face-match blocks onboarding | no | no | **yes** |

The config **fails the build** rather than producing a broken binary when
production is misconfigured — a missing URL, a plaintext `http://` URL, or an
unedited `*.invalid` placeholder from `eas.json` each stop the build with a
message naming the key to fix.

Override the face-verification gate in any environment with
`EXPO_PUBLIC_PRODUCTION_FACE_VERIFICATION=true|false`. A *technical* failure
(ML Kit or TFLite unavailable) never blocks a user in either mode — only a
genuine mismatch they can fix by retaking. The check confirms that the selfie
matches the uploaded profile photos; it is not a liveness or anti-spoofing
check. See `src/services/faceVerification.ts`.

## The native project is committed

`android/` is checked into git, so **the manifest in the repo is what gets
built**. It is currently generated from `APP_ENV=development`, which means
cleartext HTTP is enabled in it.

Re-run prebuild whenever you change `app.config.ts`, and **always** before a
release build, with the target environment set:

```powershell
$env:APP_ENV = 'production'
$env:EXPO_PUBLIC_API_URL = 'https://api.your-domain.com'
npx expo prebuild --platform android --clean
```

Skipping this step ships a production app with dev networking settings.

> `--clean` wipes `android/` and regenerates it. Anything hand-edited there is
> lost, which is why build-time settings belong in `app.config.ts` or a config
> plugin under `plugins/` — see `plugins/withGooglePayEnvironment.js`.

## Test APK on a physical device

A release-variant APK against the LAN dev backend — the quickest way to
exercise on-device face verification on real hardware:

```powershell
$env:APP_ENV = 'development'
npx expo prebuild --platform android --clean
cd android; ./gradlew assembleRelease
# → app/build/outputs/apk/release/app-release.apk
```

The phone must be on the same Wi-Fi as the machine running the docker stack,
and `extra.apiUrl` must be that machine's current LAN IP.

Locally built release APKs are signed with the **debug keystore** (see
`android/app/build.gradle`). Fine for sideloading, not valid for Play — use EAS
for anything you distribute.

## Face verification and R8

`app.config.ts` injects ProGuard keep rules for ML Kit, TensorFlow Lite, and the
Nitro runtime that `react-native-fast-tflite` binds over JNI. Minification is off
by default; the rules exist so that turning it on
(`android.enableMinifyInReleaseBuilds=true`) doesn't silently strip the face
pipeline in release builds only.

## Push notifications

`google-services.json` in this directory is an empty placeholder. `app.config.ts`
detects that and omits it, which keeps the Google Services Gradle plugin out of
the build — that plugin hard-fails on a file with no client matching
`com.kinetik.app`.

Android push therefore does not work. To enable it: download the real
`google-services.json` from the Firebase console, replace the placeholder, and
run `npx eas init` to create the `extra.eas.projectId` that `expo-notifications`
needs for push tokens.

## Google Pay

`plugins/withGooglePayEnvironment.js` writes `GOOGLE_PAY_ENVIRONMENT` into
`android/gradle.properties`, where `@google/react-native-make-payment` reads it
at build time.

It stays on `TEST` unless the build environment explicitly sets
`GOOGLE_PAY_ENVIRONMENT=PRODUCTION`. This is deliberately **not** tied to
`APP_ENV`: a production app build is a separate decision from putting the
payment sheet into production, which charges real cards and is only valid after
the Google Pay & Wallet Console approves the app. See `PAYMENT_INTEGRATION.md`.
