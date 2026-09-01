import fs from 'fs';
import path from 'path';
import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Kinetik Mobile — build-time configuration
 *
 * `app.json` holds everything that never varies (icons, permissions, plugin
 * list). This file layers the parts that DO vary per environment on top:
 * backend URLs, cleartext-HTTP allowance, and the face-verification gate.
 *
 * Select an environment with `APP_ENV` (development | preview | production);
 * EAS sets it per build profile in `eas.json`. Everything here is frozen into
 * the binary at build time — changing any of it requires a rebuild, not an
 * app restart.
 *
 *   APP_ENV=development npx expo run:android      # LAN backend over http://
 *   eas build --profile production --platform android
 *
 * Production is deliberately strict: the build FAILS rather than producing an
 * APK/AAB that points at a LAN address or talks plaintext HTTP.
 */

type AppEnv = 'development' | 'preview' | 'production';

const APP_ENVS: AppEnv[] = ['development', 'preview', 'production'];

/** Backend used when nothing is configured — the maintainer's dev machine. */
const DEFAULT_DEV_API_URL = 'http://192.168.31.144:8080';

function resolveAppEnv(): AppEnv {
  const raw = process.env.APP_ENV ?? 'development';
  if (!APP_ENVS.includes(raw as AppEnv)) {
    throw new Error(
      `[app.config] APP_ENV must be one of ${APP_ENVS.join(' | ')} (got "${raw}")`,
    );
  }
  return raw as AppEnv;
}

/** Reserved names that can never resolve — i.e. an unedited placeholder. */
function isPlaceholderHost(url: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    throw new Error(`[app.config] "${url}" is not a valid URL.`);
  }
  return (
    /\.(invalid|example|test|localhost)$/.test(hostname) ||
    /^(localhost|127\.0\.0\.1|\[::1\])$/.test(hostname)
  );
}

/**
 * Resolve the API/WS base URLs for this environment.
 *
 * Development falls back to the LAN default so `expo run:android` keeps
 * working with no env setup. preview/production have no fallback on purpose —
 * a missing URL must fail the build, never silently ship the dev address.
 */
function resolveUrls(appEnv: AppEnv): { apiUrl: string; wsUrl: string } {
  const apiUrl =
    process.env.EXPO_PUBLIC_API_URL ??
    (appEnv === 'development' ? DEFAULT_DEV_API_URL : undefined);

  if (!apiUrl) {
    throw new Error(
      `[app.config] EXPO_PUBLIC_API_URL is required for APP_ENV=${appEnv}.\n` +
        `  Set it in the "${appEnv}" profile's "env" block in eas.json, or export it before building.`,
    );
  }

  // WS defaults to the API host — nginx proxies both on the same origin.
  const wsUrl = process.env.EXPO_PUBLIC_WS_URL ?? apiUrl;

  if (appEnv !== 'development') {
    for (const [name, url] of [
      ['EXPO_PUBLIC_API_URL', apiUrl],
      ['EXPO_PUBLIC_WS_URL', wsUrl],
    ] as const) {
      // Android blocks cleartext in release builds and iOS ATS rejects it, so
      // an http:// production URL yields an app where every request fails at
      // runtime. Catch it here, where the error is readable.
      if (appEnv === 'production' && !/^(https|wss):\/\//.test(url)) {
        throw new Error(
          `[app.config] ${name} must use https:// or wss:// in production (got "${url}").`,
        );
      }

      // eas.json ships reserved-TLD placeholders so the key is discoverable in
      // the profile it belongs to. They resolve nowhere, so a build still
      // carrying one would install fine and fail on every request — refuse it.
      if (isPlaceholderHost(url)) {
        throw new Error(
          `[app.config] ${name} is still the placeholder "${url}".\n` +
            `  Set the real host in the "${appEnv}" profile's "env" block in eas.json.`,
        );
      }
    }
  }

  return { apiUrl, wsUrl };
}

/**
 * Whether a failed face match blocks onboarding until the user retakes.
 * Defaults on in production, off elsewhere; override with
 * EXPO_PUBLIC_PRODUCTION_FACE_VERIFICATION. A *technical* failure never blocks
 * in either mode — see services/faceVerification.ts.
 */
function resolveProductionFaceVerification(appEnv: AppEnv): boolean {
  const raw = process.env.EXPO_PUBLIC_PRODUCTION_FACE_VERIFICATION;
  if (raw != null && raw !== '') return raw.toLowerCase() === 'true';
  return appEnv === 'production';
}

/**
 * Wire up `google-services.json` only when a real Firebase config for this
 * package is present. There is none by default: Android push is not set up,
 * and the Google Services Gradle plugin hard-fails on a missing or non-matching
 * file ("No matching client found for package name"), which would break every
 * Android build. Returning undefined keeps the plugin out of Gradle entirely.
 *
 * Drop the real file in from the Firebase console and it is picked up
 * automatically — nothing else needs editing.
 */
function resolveGoogleServicesFile(
  projectRoot: string,
  androidPackage: string,
): string | undefined {
  const relative = './google-services.json';
  const absolute = path.join(projectRoot, relative);

  if (!fs.existsSync(absolute)) return undefined;

  try {
    const parsed = JSON.parse(fs.readFileSync(absolute, 'utf8'));
    const matches = (parsed?.client ?? []).some(
      (c: any) => c?.client_info?.android_client_info?.package_name === androidPackage,
    );
    if (matches) return relative;
  } catch {
    // Fall through to the warning below — malformed file is as unusable as a stub.
  }

  console.warn(
    `[app.config] Ignoring google-services.json — no Firebase client for "${androidPackage}".\n` +
      `  Android push notifications will not work. Download the real file from the Firebase console to enable them.`,
  );
  return undefined;
}

/**
 * Keep the native face-verification stack out of R8's reach. Minification is
 * off by default, but these classes are reached reflectively / over JNI, so
 * turning it on without them silently breaks verification in release only.
 */
const FACE_VERIFICATION_PROGUARD_RULES = `
# --- On-device face verification (see services/faceVerification.ts) ---
# ML Kit face detection - loaded reflectively by Play Services
-keep class com.google.mlkit.** { *; }
-keep class com.google.android.gms.internal.mlkit_** { *; }
-dontwarn com.google.mlkit.**
# @react-native-ml-kit/face-detection bridge module
-keep class com.rnmlkit.facedetection.** { *; }
# TensorFlow Lite interpreter (MobileFaceNet embeddings)
-keep class org.tensorflow.** { *; }
-dontwarn org.tensorflow.**
# react-native-fast-tflite plus its Nitro Modules runtime, bound over JNI
-keep class com.margelo.nitro.** { *; }
`.trim();

export default ({ config }: ConfigContext): ExpoConfig => {
  const appEnv = resolveAppEnv();
  const { apiUrl, wsUrl } = resolveUrls(appEnv);
  const productionFaceVerification = resolveProductionFaceVerification(appEnv);

  const androidPackage = config.android?.package ?? 'com.kinetik.app';
  const googleServicesFile = resolveGoogleServicesFile(
    config._internal?.projectRoot ?? __dirname,
    androidPackage,
  );

  // Cleartext is needed only to reach a plain-http:// dev backend. Production
  // is https-only (enforced above), so it stays off there — leaving it on
  // would weaken every request the shipped app makes.
  const usesCleartextTraffic =
    appEnv !== 'production' && [apiUrl, wsUrl].some((u) => u.startsWith('http://'));

  // Plugins this file owns. Filter any copy out of the app.json list first so
  // that `expo install expo-build-properties` (which appends a bare entry
  // there) can't produce a duplicate registration.
  const MANAGED_PLUGINS = ['expo-build-properties'];
  const plugins = (config.plugins ?? []).filter((plugin) => {
    const name = Array.isArray(plugin) ? plugin[0] : plugin;
    return typeof name !== 'string' || !MANAGED_PLUGINS.includes(name);
  });

  const android = { ...config.android, googleServicesFile };
  if (!googleServicesFile) delete android.googleServicesFile;

  // NSAllowsLocalNetworking exists so the iOS dev build can reach the LAN
  // backend; a shipped build has no business allowing plaintext at all.
  const infoPlist = { ...config.ios?.infoPlist };
  if (appEnv === 'production') delete infoPlist.NSAppTransportSecurity;

  return {
    ...config,
    name: config.name ?? 'Kinetik',
    slug: config.slug ?? 'kinetik',
    android,
    ios: { ...config.ios, infoPlist },
    plugins: [
      ...plugins,
      [
        'expo-build-properties',
        {
          android: {
            usesCleartextTraffic,
            extraProguardRules: FACE_VERIFICATION_PROGUARD_RULES,
          },
        },
      ],
    ],
    extra: {
      ...config.extra,
      appEnv,
      apiUrl,
      wsUrl,
      productionFaceVerification,
    },
  };
};
