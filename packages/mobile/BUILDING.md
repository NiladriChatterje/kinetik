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

The config **fails the build** rather than producing a broken binary when
production is misconfigured — a missing URL, a plaintext `http://` URL, or an
unedited `*.invalid` placeholder from `eas.json` each stop the build with a
message naming the key to fix.

Face verification behaves the same in every environment: a selfie that does
not match shows the match percentage with Retake and Skip for now, and a
technical failure shows Try Again and Skip for now, never error text. The
check confirms that the selfie matches the uploaded profile photos; it is not
a liveness or anti-spoofing check. See `src/services/faceVerification.ts`.

Test the selfie step on a **release** build before shipping. A dev build
loads the face model from Metro over http, which hides release-only asset
problems (versionCode 7 to 9 failed every check this way).

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
`android/app/build.gradle`). Fine for sideloading, not valid for Play.

For an APK against production, build `:app:assembleRelease` from `android/`
with `APP_ENV=production` and `EXPO_PUBLIC_API_URL` set, plus
`--offline --no-daemon -PreactNativeArchitectures=arm64-v8a
-Dorg.gradle.workers.max=2 -Dorg.gradle.parallel=false`: more workers make
clang run out of memory on a 16 GB machine. A debug-signed APK cannot be
installed over a Play or EAS build; uninstall that first.

## Play AAB without an EAS cloud build

`npm run build:aab:local` builds the store bundle on this machine, offline by
default (`-- --online` lets Gradle download dependencies), signed with the
Play upload key. It takes APP_ENV and the API URL from `eas.json`'s
production profile.

The upload key lives on Expo's servers. Download it once (no build quota):

```powershell
npx eas credentials -p android
# production → credentials.json → Download credentials from EAS to credentials.json
```

That writes `credentials.json` and `credentials/android/keystore.jks` here;
both are gitignored, and the root `.gitignore` keeps them out of EAS uploads.
Keep a backup outside the repo.

Bump `versionCode` in both `app.json` and `android/app/build.gradle` first —
EAS `autoIncrement` does not run locally, and the script refuses to build
when the two differ. Output:
`android/app/build/outputs/bundle/release/app-release.aab`.

## Face verification and R8

`app.config.ts` injects ProGuard keep rules for ML Kit, TensorFlow Lite, and the
Nitro runtime that `react-native-fast-tflite` binds over JNI. Minification is off
by default; the rules exist so that turning it on
(`android.enableMinifyInReleaseBuilds=true`) doesn't silently strip the face
pipeline in release builds only.

## Push notifications

Android push is not set up, and there is no `google-services.json` in this
directory. `app.config.ts` only declares one when a real Firebase config for
`com.kinetik.app` is present, which keeps the Google Services Gradle plugin out
of the build — that plugin hard-fails on a missing or non-matching file.

Nothing in the app depends on it: `notificationStore` already gives up when
`extra.eas.projectId` is absent, so only socket-driven in-app updates work.

To enable push you need both halves:

1. Download the real `google-services.json` from the Firebase console into this
   directory. It is picked up automatically — no config edit needed.
2. Run `npx eas init` to create the `extra.eas.projectId` that
   `expo-notifications` needs to mint a push token.

## Google Pay

`plugins/withGooglePayEnvironment.js` writes `GOOGLE_PAY_ENVIRONMENT` into
`android/gradle.properties`, where `@google/react-native-make-payment` reads it
at build time.

It stays on `TEST` unless the build environment explicitly sets
`GOOGLE_PAY_ENVIRONMENT=PRODUCTION`. This is deliberately **not** tied to
`APP_ENV`: a production app build is a separate decision from putting the
payment sheet into production, which charges real cards and is only valid after
the Google Pay & Wallet Console approves the app. See `PAYMENT_INTEGRATION.md`.
