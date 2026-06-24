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
 * Option A — app.json (static, checked in to Git):
 *   Edit "extra.apiUrl" directly.
 *
 * Option B — Environment variables with app.config.ts:
 *   Create app.config.ts that reads EXPO_PUBLIC_API_URL / EXPO_PUBLIC_WS_URL
 *   and passes them into extra. Preferred for CI/CD.
 *
 * Option C — Build-time override:
 *   Constants.expoConfig?.extra values are evaluated at build time,
 *   so rebuilding with different config is required.
 */

import Constants from 'expo-constants';

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

if (typeof __DEV__ !== 'undefined' && __DEV__) {
  console.log('[Config] API_URL:', API_URL);
  console.log('[Config] WS_URL:', WS_URL);
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
