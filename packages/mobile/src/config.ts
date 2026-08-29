/**
 * Kinetik Mobile — Central Configuration
 *
 * ─── Single source of truth for all URLs ────────────────────────
 *
 * To deploy this app to a different server, set ONLY the `apiUrl` in
 * app.json → "expo" → "extra" → "apiUrl". The WebSocket URL will
 * default to the same host:port (nginx handles routing both).
 *
 *   "extra": {
 *     "apiUrl": "https://api.kinetik.app",
 *   }
 *
 * If your WebSocket server runs on a different address, set `wsUrl`
 * explicitly:
 *
 *   "extra": {
 *     "apiUrl": "https://api.kinetik.app",
 *     "wsUrl": "wss://ws.kinetik.app"
 *   }
 *
 * ─── How to configure per environment ───────────────────────────
 *
 * `app.config.ts` populates `extra` from the environment at build time —
 * see that file for the rules. In short:
 *
 *   APP_ENV=development           → LAN backend over http:// (cleartext allowed)
 *   APP_ENV=preview|production    → EXPO_PUBLIC_API_URL required; production
 *                                   additionally must be https:// / wss://
 *
 * EAS sets APP_ENV per build profile (`eas.json`). Every value below is
 * frozen into the binary at build time, so changing one needs a rebuild —
 * restarting the app is not enough.
 */

import Constants from 'expo-constants';

// ─── Environment ───────────────────────────────────────────────

export type AppEnv = 'development' | 'preview' | 'production';

/**
 * Which build profile produced this binary. Set by app.config.ts from
 * APP_ENV; falls back to 'development' for bundles built before it existed.
 */
export const APP_ENV: AppEnv =
  (Constants.expoConfig?.extra?.appEnv as AppEnv | undefined) ?? 'development';

// ─── Base URLs ─────────────────────────────────────────────────

/**
 * API HTTP base URL (Fastify backend, proxied through nginx).
 */
export const API_URL: string =
  Constants.expoConfig?.extra?.apiUrl || 'http://localhost:3001';

/**
 * WebSocket server URL (Socket.IO realtime service).
 *
 * - If wsUrl is explicitly configured in app.json, use it.
 * - If only apiUrl is configured, assume WS runs via the same nginx proxy.
 * - If neither is configured (dev mode), use the standalone WS port.
 */
const configuredWsUrl = Constants.expoConfig?.extra?.wsUrl as string | undefined;
const configuredApiUrl = Constants.expoConfig?.extra?.apiUrl as string | undefined;

export const WS_URL: string = configuredWsUrl
  ? configuredWsUrl
  : configuredApiUrl
    ? API_URL // WS goes through nginx on the same host:port
    : 'http://localhost:3002'; // Dev mode: standalone WS on port 3002

// ─── Feature Flags ─────────────────────────────────────────────

/**
 * Enforce on-device face verification during onboarding.
 *
 *   false — a failed match is shown but onboarding continues.
 *   true  — a failed match blocks until the user retakes.
 *
 * Defaults to true when APP_ENV=production, false otherwise. Override either
 * way with EXPO_PUBLIC_PRODUCTION_POSE — a build-time value, so changing it
 * needs a rebuild.
 *
 * A TECHNICAL failure (TFLite/ML Kit unavailable, model missing) never blocks
 * in either mode: a broken build must not stop every signup. Only a genuine
 * mismatch the user can fix by retaking is enforced.
 */
export const PRODUCTION_POSE: boolean =
  String(process.env.EXPO_PUBLIC_PRODUCTION_POSE ?? '').toLowerCase() === 'true' ||
  Constants.expoConfig?.extra?.productionPose === true;

if (typeof __DEV__ !== 'undefined' && __DEV__) {
  console.log('[Config] APP_ENV:', APP_ENV);
  console.log('[Config] API_URL:', API_URL);
  console.log('[Config] WS_URL:', WS_URL);
  console.log('[Config] PRODUCTION_POSE:', PRODUCTION_POSE);
}

// ─── URL Resolution ────────────────────────────────────────────

/**
 * Resolve a potentially-relative URL against the API base URL.
 *
 * - Absolute URLs (http:// / https://) are returned unchanged.
 * - Relative paths (e.g. "/uploads/user/abc.webp") are prefixed with `API_URL`.
 *
 * Use this when displaying asset URLs returned by the backend
 * (profile photos, thumbnails, uploaded files, etc.) so they work
 * correctly regardless of deployment environment.
 *
 * @example
 *   resolveUrl('/uploads/user123/photo.webp')
 *   // → 'http://localhost:3001/uploads/user123/photo.webp'
 *
 *   resolveUrl('https://cdn.kinetik.app/photo.webp')
 *   // → 'https://cdn.kinetik.app/photo.webp'   (unchanged)
 */
export function resolveUrl(path: string): string {
  if (!path) return path;
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path; // Already absolute
  }
  const base = API_URL.endsWith('/') ? API_URL.slice(0, -1) : API_URL;
  const relative = path.startsWith('/') ? path : `/${path}`;
  return `${base}${relative}`;
}
