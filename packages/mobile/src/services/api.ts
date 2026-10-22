import * as SecureStore from 'expo-secure-store';
import * as FileSystem from 'expo-file-system/legacy';
import { API_URL, WS_URL } from '../config';
// Deferred-use circular import (proximity.ts calls api.getAreaDetails at
// runtime, never at module init) — safe under Metro.
import { rankByProximity } from '../utils/proximity';

/** The sign-up form, sent before the emailed code is verified. */
export interface SignupForm {
  email: string;
  password: string;
  displayName?: string;
  countryCode: string;
  city: string;
  stateCode?: string;
}

/** What the server says about a sign-up code it just emailed. */
export interface SignupCodeInfo {
  expiresInSeconds: number;
  maxAttempts: number;
  /** Codes that can still be emailed to this address today */
  sendsLeft: number;
}

interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown; status?: number };
}

/**
 * Outcome of a silent token refresh.
 *  - refreshed:   new access token stored, retry the request
 *  - rejected:    server said the refresh token is invalid or the account is
 *                 gone (401/403/404). Tokens are cleared; the session is over.
 *  - unavailable: could not reach the server or it answered 5xx. Tokens are
 *                 kept; the session is still valid, the server is not.
 */
type RefreshOutcome = 'refreshed' | 'rejected' | 'unavailable';


/**
 * How long a request may take before the app gives up on it. The database
 * sleeps when idle and takes 20-30 s to wake; the server waits for it (up to
 * about 48 s, see connectWithRetry in packages/shared) and nginx allows 60 s.
 * Giving up earlier showed an empty chat list or chat on a cold start.
 */
const REQUEST_TIMEOUT_MS = 55000;

/**
 * A request still unanswered after this long is almost always the database
 * waking up. The app is told so it can say "server waking up" instead of
 * leaving a silent spinner (see onSlowChange).
 */
const SLOW_AFTER_MS = 8000;

/**
 * Calls that cannot use request()'s refresh-on-401 (native uploads, media
 * URLs, the realtime handshake) renew the access token first when it has
 * less than this left (see getFreshToken).
 */
const REFRESH_AHEAD_MS = 2 * 60 * 1000;

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** The `iat` and `exp` claims (seconds) of a JWT; null if it cannot be read. */
function readTokenTimes(token: string): { iat: number; exp: number } | null {
  try {
    const payload = token.split('.')[1] ?? '';
    let text = '';
    let bits = 0;
    let value = 0;
    for (const ch of payload) {
      const digit = BASE64URL.indexOf(ch);
      if (digit < 0) continue; // padding
      value = ((value << 6) | digit) & 0xffffff;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        text += String.fromCharCode((value >> bits) & 0xff);
      }
    }
    const { iat, exp } = JSON.parse(text);
    return typeof iat === 'number' && typeof exp === 'number' && exp > iat ? { iat, exp } : null;
  } catch {
    return null;
  }
}

/** One billing history row; `id` is the paging cursor. */
export interface BillingPayment {
  id: string;
  paymentId: string | null;
  amount: number | null;
  currency: string;
  status: string;
  description: string;
  paidAt: string;
}

class ApiClient {
  private token: string | null = null;
  /** When the access token runs out, on this device's clock; null if unknown. */
  private tokenExpiresAt: number | null = null;
  private refreshTokenValue: string | null = null;
  private isRefreshing = false;
  private refreshPromise: Promise<RefreshOutcome> | null = null;
  private accountMissingListener: (() => void) | null = null;
  private reachabilityListener: ((reachable: boolean) => void) | null = null;
  private serverReachable = true;
  private slowListener: ((slow: boolean) => void) | null = null;
  private slowInFlight = 0;

  async init() {
    this.token = await SecureStore.getItemAsync('auth_token');
    this.refreshTokenValue = await SecureStore.getItemAsync('refresh_token');
    // A stored token's age is unknown, so its expiry is read on this
    // device's clock. A clock that is off costs at most one early refresh,
    // or a request that renews on its 401 as before.
    const times = this.token ? readTokenTimes(this.token) : null;
    this.tokenExpiresAt = times ? times.exp * 1000 : null;
  }

  /** Returns the current auth token, as it is (see getFreshToken). */
  getToken(): string | null {
    return this.token;
  }

  /**
   * The access token, renewed first when it has under REFRESH_AHEAD_MS left.
   * For calls that cannot renew on a 401 the way request() does: native
   * uploads, media URLs and the realtime handshake. Never throws; when the
   * server cannot renew it, the current token is returned and the call
   * fails as it would have.
   */
  async getFreshToken(): Promise<string | null> {
    if (
      this.token &&
      this.refreshTokenValue &&
      this.tokenExpiresAt !== null &&
      this.tokenExpiresAt - Date.now() < REFRESH_AHEAD_MS
    ) {
      await this.tryRefresh();
    }
    return this.token;
  }

  /**
   * Renews the access token now, whatever its expiry says. For a token the
   * realtime server refused: a phone clock running behind makes an expired
   * token look fresh. Returns the token to use, or null once signed out.
   */
  async renewToken(): Promise<string | null> {
    if (this.token && this.refreshTokenValue) await this.tryRefresh();
    return this.token;
  }

  setToken(token: string | null) {
    // Every new token here comes straight from the server (login, sign-up,
    // refresh), so it is timed by its lifetime from now, which holds even on
    // a phone whose clock is wrong. Re-setting the same token (app start)
    // keeps the estimate init() made.
    if (token !== this.token) {
      const times = token ? readTokenTimes(token) : null;
      this.tokenExpiresAt = times ? Date.now() + (times.exp - times.iat) * 1000 : null;
    }
    this.token = token;
    if (token) {
      SecureStore.setItemAsync('auth_token', token);
    } else {
      SecureStore.deleteItemAsync('auth_token');
    }
  }

  setRefreshToken(rt: string | null) {
    this.refreshTokenValue = rt;
    if (rt) {
      SecureStore.setItemAsync('refresh_token', rt);
    } else {
      SecureStore.deleteItemAsync('refresh_token');
    }
  }

  getRefreshToken(): string | null {
    return this.refreshTokenValue;
  }

  /**
   * Called when a signed-in request is answered with USER_NOT_FOUND: the token
   * is valid but the account behind it no longer exists. The auth store uses
   * it to sign out from wherever in the app the request was made.
   */
  onAccountMissing(listener: (() => void) | null) {
    this.accountMissingListener = listener;
  }

  /**
   * Called with `false` when a request could not reach the server at all
   * (no response: refused, no network, timed out) and with `true` when the
   * next request after that gets any response. Fires once per transition,
   * so a burst of failing requests at launch counts as one outage. The auth
   * store uses it for the offline pill and the retry-then-sign-out loop.
   */
  onReachabilityChange(listener: ((reachable: boolean) => void) | null) {
    this.reachabilityListener = listener;
  }

  private reportReachable(reachable: boolean) {
    if (this.serverReachable === reachable) return;
    this.serverReachable = reachable;
    this.reachabilityListener?.(reachable);
  }

  /**
   * Called with `true` when some request has been waiting longer than
   * SLOW_AFTER_MS without an answer, and with `false` once no such request
   * is left. Fires once per transition. The auth store shows the
   * "server waking up" pill from it.
   */
  onSlowChange(listener: ((slow: boolean) => void) | null) {
    this.slowListener = listener;
  }

  /** Starts the slow-request clock; call the returned function when the request ends. */
  private watchSlow(): () => void {
    let counted = false;
    const timer = setTimeout(() => {
      counted = true;
      this.slowInFlight += 1;
      if (this.slowInFlight === 1) this.slowListener?.(true);
    }, SLOW_AFTER_MS);
    return () => {
      clearTimeout(timer);
      if (!counted) return;
      this.slowInFlight -= 1;
      if (this.slowInFlight === 0) this.slowListener?.(false);
    };
  }

  /**
   * Attempt to silently refresh the access token using the refresh token.
   * Deduplicates concurrent calls so only one refresh request fires.
   */
  private async tryRefresh(): Promise<RefreshOutcome> {
    // No refresh token at all (a session from before refresh tokens existed):
    // nothing to retry with, the 401 stands.
    if (!this.refreshTokenValue) return 'rejected';

    // Deduplicate concurrent refresh attempts
    if (this.isRefreshing && this.refreshPromise) {
      return this.refreshPromise;
    }

    this.isRefreshing = true;
    this.refreshPromise = (async (): Promise<RefreshOutcome> => {
      const doneSlow = this.watchSlow();
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        const res = await fetch(`${API_URL}/api/v1/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: this.refreshTokenValue }),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        const body = await res.json().catch(() => null);
        if (res.ok && body?.success && body.data?.token) {
          this.setToken(body.data.token);
          if (body.data.refreshToken) {
            this.setRefreshToken(body.data.refreshToken);
          }
          return 'refreshed';
        }

        // Only an explicit, well-formed rejection ends the session: api-core's
        // own JSON envelope with 401 or 403 (token never issued, replayed, or
        // account gone). A 404 from a misrouted proxy, an nginx HTML error
        // page, a 5xx or a half-asleep database is the server's problem: keep
        // the tokens and let the caller treat it as an outage.
        if ((res.status === 401 || res.status === 403) && body && body.success === false) {
          this.setToken(null);
          this.setRefreshToken(null);
          return 'rejected';
        }
        return 'unavailable';
      } catch {
        // Timeout or no network: the session is fine, the connection is not.
        return 'unavailable';
      } finally {
        doneSlow();
        this.isRefreshing = false;
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    _isRetry = false,
  ): Promise<ApiResponse<T>> {
    const sentToken = this.token;
    const result = await this._rawRequest<T>(endpoint, options);

    // Only a signed-in request counts: login answers USER_NOT_FOUND for an
    // unknown email, which is a typo, not a deleted account. Matching the code
    // and not a bare 404 keeps a misrouted proxy 404 from signing anyone out.
    if (
      sentToken &&
      !result.success &&
      result.error?.code === 'USER_NOT_FOUND' &&
      result.error?.status === 404
    ) {
      this.accountMissingListener?.();
      return result;
    }

    // Auto-refresh on 401 UNAUTHORIZED / TOKEN_EXPIRED — retry once
    if (
      !_isRetry &&
      !result.success &&
      (result.error?.code === 'UNAUTHORIZED' || result.error?.code === 'TOKEN_EXPIRED') &&
      result.error?.status === 401
    ) {
      const outcome = await this.tryRefresh();
      if (outcome === 'refreshed') {
        return this.request<T>(endpoint, options, true);
      }
      if (outcome === 'unavailable') {
        // The access token expired and the server could not be reached to
        // renew it. Passing the 401 up would read as "session expired" and
        // log the user out, so report it as the outage it is instead.
        return {
          success: false,
          error: {
            code: 'SERVER_ERROR',
            status: 503,
            message: 'Server is unavailable. Please try again later.',
          },
        };
      }
      // Rejected — propagate the 401 (auth store handles logout)
    }

    return result;
  }

  private async _rawRequest<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string>),
    };

    // Only set Content-Type for requests that have a body.
    // Fastify rejects requests with application/json + empty body
    // (FST_ERR_CTP_EMPTY_JSON_BODY), so skip the header for bodyless
    // requests (GET, some POST/DELETE with no payload).
    if (options.body) {
      headers['Content-Type'] = 'application/json';
    }

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const doneSlow = this.watchSlow();

    try {
      const response = await fetch(`${API_URL}${endpoint}`, {
        ...options,
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeout);
      doneSlow();
      this.reportReachable(true);

      // Parse the body defensively — proxies/gateways can return non-JSON
      // (e.g. an nginx HTML error page on 502) or an empty body on success.
      let data: any;
      try {
        data = await response.json();
      } catch {
        data = undefined;
      }

      // 2xx with no usable JSON body (204, or a proxy that swallowed the
      // payload) is still a success — not an error.
      if (response.ok && data === undefined) {
        return { success: true, data: undefined };
      }

      // Non-JSON error body (nginx 502 page, Cloudflare error page, ...)
      if (data === undefined) {
        // console.log, not console.error: in development an error log pops a
        // red LogBox overlay on the phone. The user gets a toast from the
        // screen instead; this line is for the Metro terminal.
        if (__DEV__) {
          console.log(`[API] Non-JSON response ${response.status} from ${endpoint}`);
        }
        return {
          success: false,
          error: {
            code: response.status >= 500 ? 'SERVER_ERROR' : 'NETWORK_ERROR',
            status: response.status, // machine-readable for devs — never shown to the user
            message: response.status === 502
              ? 'Server is unavailable. Please try again later.'
              : 'Something went wrong on the server. Please try again.',
          },
        };
      }

      // Normalize unexpected payloads (e.g. `{ ok: true }`, bare arrays, plain
      // strings) into the { success, data?, error? } envelope so callers can
      // rely on `res.success` always being a boolean.
      if (data === null || typeof data !== 'object' || typeof data.success !== 'boolean') {
        if (!response.ok && __DEV__) {
          console.log(`[API] ${response.status} ${endpoint}:`, data);
        }
        return response.ok
          ? { success: true, data }
          : {
              success: false,
              error: {
                code: 'SERVER_ERROR',
                status: response.status, // machine-readable for devs — never shown to the user
                message: 'Something went wrong on the server. Please try again.',
              },
            };
      }

      // Log only genuine server failures (5xx). Expected 4xx business errors —
      // wrong password (401), duplicate phone (409), validation (400), rate
      // limit (429) — are surfaced to the user by each screen's toast/banner,
      // so logging them as errors here is just noise.
      if (!response.ok && __DEV__ && response.status >= 500) {
        console.log(`[API] ${response.status} ${endpoint}:`, JSON.stringify(data));
      }

      // Attach the HTTP status to error payloads so consumers can tell a
      // 401/403 ("session expired") apart from a 502 ("server down").
      if (!data.success) {
        if (!data.error || typeof data.error !== 'object') {
          data.error = {
            code: 'SERVER_ERROR',
            status: response.status, // machine-readable for devs — never shown to the user
            message: 'Something went wrong on the server. Please try again.',
          };
        } else if (!data.error.status) {
          data.error.status = response.status;
        }
      }

      return data as ApiResponse<T>;
    } catch (error: any) {
      clearTimeout(timeout);
      doneSlow();
      this.reportReachable(false);

      // Terminal only (see above): a raw "java.net.ConnectException ..."
      // must never reach the screen. The caller shows the user-level message
      // returned below.
      if (__DEV__) {
        console.log(`[API] Request failed ${endpoint}:`, error.message);
      }

      // Timeout
      if (error.name === 'AbortError') {
        return {
          success: false,
          error: { code: 'TIMEOUT', message: 'Request timed out. Please check your connection and try again.' },
        };
      }

      // Network unreachable (fetch TypeError)
      if (error instanceof TypeError) {
        return {
          success: false,
          error: {
            code: 'NETWORK_ERROR',
            message: "Can't reach the server. Please check your connection and try again.",
          },
        };
      }

      return {
        success: false,
        error: { code: 'NETWORK_ERROR', message: 'Something went wrong with the connection. Please try again.' },
      };
    }
  }

  /**
   * Parse the body of a FileSystem.uploadAsync response, tolerating non-JSON
   * bodies (gateway error pages, proxies) on any status code instead of letting
   * a raw SyntaxError escape to the caller.
   */
  private parseUploadBody(body: string, status: number): any {
    try {
      return JSON.parse(body);
    } catch {
      throw new Error(
        status >= 200 && status < 300
          ? `Server returned a non-JSON response (HTTP ${status})`
          : `Upload failed (HTTP ${status})`,
      );
    }
  }

  // ─── Health ─────────────────────────────────────────
  async healthCheck(): Promise<{ ok: boolean; error?: string }> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(`${API_URL}/health`, {
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timeout);
      // A health answer that is not OK (an nginx 502 while api-core is
      // down) is as unusable as no answer, so it counts as unreachable too.
      this.reportReachable(response.ok);
      if (response.ok) return { ok: true };
      return { ok: false, error: `Server returned ${response.status}` };
    } catch (e: any) {
      this.reportReachable(false);
      if (e.name === 'AbortError') return { ok: false, error: 'Connection timed out' };
      if (e instanceof TypeError) return { ok: false, error: 'Server unreachable' };
      return { ok: false, error: e.message || 'Connection failed' };
    }
  }

  // ─── Auth ───────────────────────────────────────────
  // Sign-up emails a code first; the account exists only once
  // signupVerify succeeds. Error replies carry attemptsLeft (wrong code) or
  // retryAfterSeconds (codes for today used up) next to the code.
  async signup(form: SignupForm) {
    return this.request<SignupCodeInfo & { email: string }>('/api/v1/auth/signup', {
      method: 'POST',
      body: JSON.stringify(form),
    });
  }

  async signupResend(email: string) {
    return this.request<SignupCodeInfo>('/api/v1/auth/signup/resend', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  }

  async signupVerify(email: string, otp: string) {
    return this.request<{ user: any; token: string; refreshToken: string }>('/api/v1/auth/signup/verify', {
      method: 'POST',
      body: JSON.stringify({ email, otp }),
    });
  }

  /** Emails a code for setting a new password (forgot password). */
  async requestPasswordReset(email: string) {
    return this.request<SignupCodeInfo>('/api/v1/auth/password/forgot', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  }

  /** Sets a new password with the emailed code; the server signs other devices out. */
  async resetPassword(email: string, otp: string, password: string) {
    return this.request<{ reset: boolean }>('/api/v1/auth/password/reset', {
      method: 'POST',
      body: JSON.stringify({ email, otp, password }),
    });
  }

  async login(data: { email: string; password: string }) {
    return this.request<{ user: any; token: string; refreshToken: string }>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * Permanently delete the authenticated user's account.
   * The server removes the profile, photos, matches and all chat history.
   */
  async deleteAccount() {
    return this.request<{ deleted: boolean }>('/api/v1/auth/account', {
      method: 'DELETE',
      body: JSON.stringify({ confirm: true }),
    });
  }

  // ─── Locations (public; behind the country → city pickers) ──
  async getCountries() {
    return this.request<{ code: string; name: string; flag: string }[]>('/api/v1/locations/countries');
  }

  /** One page of the city typeahead; the picker requests further pages as the list scrolls. */
  async searchCities(countryCode: string, q: string, offset = 0, limit = 30) {
    const qs = `country=${encodeURIComponent(countryCode)}&q=${encodeURIComponent(q)}&offset=${offset}&limit=${limit}`;
    return this.request<{ name: string; stateCode: string; latitude: number; longitude: number }[]>(
      `/api/v1/locations/cities?${qs}`,
    );
  }

  // ─── Users ─────────────────────────────────────────
  async getProfile() {
    return this.request('/api/v1/users/profile');
  }

  async updateProfile(data: any) {
    return this.request('/api/v1/users/profile', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  /** Real activity metrics for the profile page (server-counted, Redis-cached). */
  async getProfileStats() {
    return this.request<{
      matches: number;
      dates: number;
    }>('/api/v1/users/profile/stats');
  }

  async updateLocation(latitude: number, longitude: number) {
    return this.request<{
      latitude: number;
      longitude: number;
      h3Index: string;
      city: string | null;
      county: string | null;
      region: string | null;
      country: string | null;
    }>('/api/v1/users/location', {
      method: 'PUT',
      body: JSON.stringify({ latitude, longitude }),
    });
  }

  // ─── Preferences ────────────────────────────────────
  async getPreferences() {
    return this.request('/api/v1/users/preferences');
  }

  async updatePreferences(data: any) {
    return this.request('/api/v1/users/preferences', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  // ─── Onboarding ─────────────────────────────────────
  async getOnboardingStatus() {
    return this.request('/api/v1/onboarding/status');
  }

  async updateOnboardingStep(step: string, data?: any) {
    return this.request('/api/v1/onboarding/step', {
      method: 'POST',
      body: JSON.stringify({ step, data }),
    });
  }

  // ─── Matches ────────────────────────────────────────
  async getMatches() {
    return this.request('/api/v1/matches');
  }

  /** Full detail for one match, including the pinned scheduled date (dateScheduled: 'YYYY-MM-DD'). */
  async getMatchDetail(matchId: string) {
    return this.request<{ dateScheduled: string | null }>(`/api/v1/matches/${matchId}`);
  }

  /** Fix a date with the matched user. `date` is the sender's local 'YYYY-MM-DD'. */
  async setMatchDate(matchId: string, date: string) {
    return this.request<{ dateScheduled: string | null }>(`/api/v1/matches/${matchId}/date`, {
      method: 'PUT',
      body: JSON.stringify({ date }),
    });
  }

  /** Fetch the collaborative date planner data for a match. */
  async getMatchPlanner(matchId: string) {
    return this.request<{ plannerData: any | null }>(`/api/v1/matches/${matchId}/planner`);
  }

  /** Save the collaborative date planner data for a match. */
  async updateMatchPlanner(matchId: string, plannerData: any) {
    return this.request<{ plannerData: any }>(`/api/v1/matches/${matchId}/planner`, {
      method: 'PUT',
      body: JSON.stringify({ plannerData }),
    });
  }

  // ─── Venues ─────────────────────────────────────────
  async getNearbyVenues(latitude: number, longitude: number, radius?: number) {
    return this.request(`/api/v1/venues/nearby?latitude=${latitude}&longitude=${longitude}&radius=${radius || 5}`);
  }

  // ─── Payments ───────────────────────────────────────
  /** Get the user's current usage against free plan limits. */
  async getLimits() {
    return this.request<{
      tier: string;
      swipes: { used: number; limit: number };
      chats: { used: number; limit: number };
    }>('/api/v1/payments/limits');
  }

  /**
   * Fallback pricing, in the user's local currency, plus the Play product id.
   * The price actually charged is set in Play Console per region — the paywall
   * must show what the store reports and only fall back to this before the
   * store connection is ready.
   */
  async getPricing() {
    return this.request<{
      currency: string;
      symbol: string;
      amount: number;
      amountMinor: number;
      label: string;
      productId: string;
      period: string;
    }>('/api/v1/payments/pricing');
  }

  /**
   * Hands a Google Play purchase token to the server, which reads the real
   * subscription state from the Play Developer API, grants Premium, and
   * acknowledges the purchase (Google refunds anything unacknowledged after
   * three days). Safe to call again with the same token.
   *
   * `pending` comes back true when a UPI Autopay mandate has not been
   * confirmed yet — Premium is granted later, via a Play notification.
   */
  async verifyPlayPurchase(payload: {
    purchaseToken: string;
    productId?: string;
    priceAmount?: number;
    priceCurrency?: string;
  }) {
    return this.request<{
      verified: boolean;
      activated: boolean;
      pending: boolean;
      tier?: string;
      expiresAt?: string | null;
      state?: string;
    }>('/api/v1/payments/subscription/verify', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  /** Current subscription state (tier, renewal date, auto-renew) for the checkout screen. */
  async getSubscriptionStatus() {
    return this.request<{
      tier: string;
      autoRenew: boolean;
      expiresAt: string | null;
      hasPurchase: boolean;
      manageUrl: string;
    }>('/api/v1/payments/subscription/status');
  }

  /**
   * One page of billing history, newest first. `cursor` is the id of the last
   * payment already shown; `nextCursor` is null on the last page. The count
   * of completed payments (`monthsPaid`) comes with the first page only.
   */
  async getSubscriptionHistory(page: { limit?: number; cursor?: string } = {}) {
    const params = [
      page.limit ? `limit=${page.limit}` : '',
      page.cursor ? `cursor=${encodeURIComponent(page.cursor)}` : '',
    ].filter(Boolean);
    return this.request<{
      payments: BillingPayment[];
      nextCursor: string | null;
      monthsPaid?: number;
    }>(`/api/v1/payments/subscription/history${params.length ? `?${params.join('&')}` : ''}`);
  }

  /**
   * Stops the subscription renewing at Google Play. The user keeps Premium
   * until the end of the period already paid for, and can restore renewal
   * from Play without buying again.
   */
  async cancelSubscription() {
    return this.request<{
      cancelled: boolean;
      expiresAt: string | null;
      manageUrl: string;
    }>('/api/v1/payments/subscription/cancel', { method: 'POST' });
  }

  // ─── Notifications ──────────────────────────────────
  async registerPushToken(token: string, platform: 'ios' | 'android' | 'web') {
    return this.request('/api/v1/notifications/register-token', {
      method: 'POST',
      body: JSON.stringify({ token, platform }),
    });
  }

  async unregisterPushToken(token: string) {
    return this.request('/api/v1/notifications/unregister-token', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  }

  async getNotificationPreferences() {
    return this.request<{ pushEnabled: boolean }>('/api/v1/notifications/preferences');
  }

  async updateNotificationPreferences(data: { pushEnabled?: boolean }) {
    return this.request('/api/v1/notifications/preferences', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  // ─── Interests ──────────────────────────────────────
  async getInterests() {
    return this.request('/api/v1/users/interests');
  }

  // ─── Photos ───────────────────────────────────────────
  async deletePhoto(photoId: string): Promise<void> {
    const response = await this.request(`/api/v1/users/photos/${photoId}`, {
      method: 'DELETE',
    });
    if (!response.success) {
      throw new Error(response.error?.message || 'Failed to delete photo');
    }
  }

  async getPhotos() {
    return this.request('/api/v1/users/photos');
  }

  async setPrimaryPhoto(photoId: string) {
    return this.request(`/api/v1/users/photos/${photoId}/primary`, {
      method: 'PUT',
    });
  }

  // ─── KYC Documents & Face Verification ────────────────────
  async verifyKycFace(): Promise<{
    match: boolean;
    confidence: number;
    faceDetectedInDocument: boolean;
    profileFacesDetected: number;
    rejectionReasons: string[];
    kycStatus: string;
  }> {
    const response = await this.request<{
      match: boolean;
      confidence: number;
      faceDetectedInDocument: boolean;
      profileFacesDetected: number;
      rejectionReasons: string[];
      kycStatus: string;
    }>('/api/v1/kyc/verify-face', {
      method: 'POST',
    });
    if (!response.success) {
      throw new Error(response.error?.message || 'Face verification failed');
    }
    return response.data!;
  }

  // ─── KYC Documents ────────────────────────────────────────
  async submitKycDocument(uri: string, documentType: string, mimeType: string): Promise<{
    id: string;
    documentType: string;
    status: string;
    fileName: string;
    url: string;
  }> {
    const token = await this.getFreshToken();
    const url = `${API_URL}/api/v1/kyc/documents`;

    const result = await Promise.race([
      FileSystem.uploadAsync(url, uri, {
        httpMethod: 'POST',
        uploadType: FileSystem.FileSystemUploadType.MULTIPART,
        fieldName: 'file',
        mimeType: mimeType,
        parameters: {
          document_type: documentType,
        },
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Upload timed out. Please try again.')), 60000),
      ),
    ]);

    let body: any;
    try {
      body = this.parseUploadBody(result.body, result.status);
    } catch (e: any) {
      throw new Error(e?.message || `Upload failed (HTTP ${result.status})`);
    }

    if (result.status >= 200 && result.status < 300) {
      return body?.data;
    }

    throw new Error(body?.error?.message || `Upload failed (HTTP ${result.status})`);
  }

  /**
   * Aadhaar Paperless Offline e-KYC: upload the myAadhaar zip with its share
   * code. The server verifies UIDAI's signature, checks 18+, matches the
   * photo, and keeps nothing but a verified flag.
   */
  async submitAadhaarOffline(uri: string, shareCode: string): Promise<{
    verified: boolean;
    faceChecked: boolean;
    confidence?: number;
    reason?: string;
    kycStatus?: string;
  }> {
    const token = await this.getFreshToken();
    const url = `${API_URL}/api/v1/kyc/aadhaar-offline`;

    const result = await Promise.race([
      FileSystem.uploadAsync(url, uri, {
        httpMethod: 'POST',
        uploadType: FileSystem.FileSystemUploadType.MULTIPART,
        fieldName: 'file',
        mimeType: 'application/zip',
        parameters: { share_code: shareCode },
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Upload timed out. Please try again.')), 60000),
      ),
    ]);

    let body: any;
    try {
      body = this.parseUploadBody(result.body, result.status);
    } catch (e: any) {
      throw new Error(e?.message || `Verification failed (HTTP ${result.status})`);
    }
    if (result.status >= 200 && result.status < 300 && body?.success) {
      return body.data;
    }
    throw new Error(body?.error?.message || `Verification failed (HTTP ${result.status})`);
  }

  async getKycStatus(): Promise<{
    kycStatus: string;
    aadhaarOfflineAvailable?: boolean;
    latestDocument: {
      id: string;
      document_type: string;
      status: string;
      created_at: string;
    } | null;
    faceVerificationAvailable?: boolean;
  }> {
    const response = await this.request<{
      kycStatus: string;
      latestDocument: {
        id: string;
        document_type: string;
        status: string;
        created_at: string;
      } | null;
      faceVerificationAvailable?: boolean;
    }>('/api/v1/kyc/status');
    if (!response.success) {
      throw new Error(response.error?.message || 'Failed to get KYC status');
    }
    return response.data!;
  }

  // ─── Area / Location Details ─────────────────────────────
  async getAreaDetails(): Promise<{
    latitude: number | null;
    longitude: number | null;
    h3Index: string | null;
    city: string | null;
    county: string | null;
    region: string | null;
    country: string | null;
    locationUpdatedAt: string | null;
  }> {
    const response = await this.request<{
      latitude: number | null;
      longitude: number | null;
      h3Index: string | null;
      city: string | null;
      county: string | null;
      region: string | null;
      country: string | null;
      locationUpdatedAt: string | null;
    }>('/api/v1/users/location/area');
    if (!response.success) {
      throw new Error(response.error?.message || 'Failed to get area details');
    }
    return response.data!;
  }

  // ─── Match / Swipe ────────────────────────────────────
  /**
   * Paginated browse over everyone eligible on the platform (Explore grid).
   * Each page is ranked nearest-first on-device.
   */
  async getExploreProfiles(offset = 0, limit = 24) {
    const res = await this.request<{ profiles: any[]; hasMore?: boolean; offset?: number }>(
      `/api/v1/matches/profiles?scope=explore&offset=${offset}&limit=${limit}`,
    );
    if (res.success && res.data?.profiles?.length) {
      res.data.profiles = await rankByProximity(res.data.profiles);
    }
    return res;
  }

  async getSwipeProfiles() {
    const res = await this.request<{ profiles: any[] }>('/api/v1/matches/profiles');
    // Nearest-first, computed on-device from coarse cell centers.
    // Falls back to server order when location is unavailable.
    if (res.success && res.data?.profiles?.length) {
      res.data.profiles = await rankByProximity(res.data.profiles);
    }
    return res;
  }

  async swipe(targetUserId: string, action: 'like' | 'pass' | 'super_like') {
    return this.request<{ matched: boolean; isSuperLike?: boolean; superLikesRemaining?: number; swipesRemaining?: number; matchId?: string; partnerName?: string; partnerId?: string }>('/api/v1/matches/swipe', {
      method: 'POST',
      body: JSON.stringify({ targetUserId, action }),
    });
  }

  async getIncomingLikes() {
    // locked: free account; likes holds only their newest few, totalCount counts them all
    return this.request<{ likes: any[]; totalCount: number; locked?: boolean }>('/api/v1/matches/likes');
  }

  /** A liker's full profile, shaped like a deck card, to open from the Likes list. */
  async getLikerProfile(userId: string) {
    return this.request<{ profile: any }>(`/api/v1/matches/likes/${userId}/profile`);
  }

  async respondToLike(targetUserId: string, action: 'like' | 'discard') {
    return this.request<{ matched: boolean; matchId?: string; partnerName?: string; partnerId?: string }>('/api/v1/matches/respond', {
      method: 'POST',
      body: JSON.stringify({ targetUserId, action }),
    });
  }

  async getConversations() {
    return this.request<{ conversations: any[] }>('/api/v1/matches/conversations');
  }

  /** Unmatch a user: deletes all messages, media, and deactivates the match. */
  async unmatchUser(matchId: string) {
    return this.request<{ unmatched: boolean }>(`/api/v1/matches/conversations/${matchId}`, {
      method: 'DELETE',
    });
  }

  // ─── Safety: report and block ───────────────────────

  /** Report a member. `reason` is one of the keys in ReportBlockSheet's REASONS. */
  async reportUser(reportedUserId: string, reason: string, details?: string, matchId?: string) {
    return this.request<{ reportId: string }>('/api/v1/safety/report', {
      method: 'POST',
      body: JSON.stringify({ reportedUserId, reason, details, matchId }),
    });
  }

  /** Block a member: hides both people from each other and ends their chat. */
  async blockUser(userId: string) {
    return this.request<{ blocked: boolean }>('/api/v1/safety/block', {
      method: 'POST',
      body: JSON.stringify({ userId }),
    });
  }

  /**
   * The newest page of a conversation, or with `beforeId` the page of older
   * messages strictly before that message. `hasMore` says whether an older
   * page exists.
   */
  async getMessages(matchId: string, beforeId?: string) {
    const cursor = beforeId ? `?beforeId=${encodeURIComponent(beforeId)}` : '';
    return this.request<{ messages: any[]; hasMore?: boolean }>(`/api/v1/matches/conversations/${matchId}/messages${cursor}`);
  }

  async sendMessage(matchId: string, content: string) {
    return this.request<{ id: string; matchId: string; senderId: string; content: string; createdAt: string; readAt: string | null }>(`/api/v1/matches/conversations/${matchId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
  }

  async sendMediaMessage(matchId: string, uri: string, mediaType: string, caption?: string, viewOnce?: boolean, durationSecs?: number) {
    const token = await this.getFreshToken();
    let url = `${API_URL}/api/v1/matches/conversations/${matchId}/media?media_type=${mediaType}`;
    if (caption) url += `&caption=${encodeURIComponent(caption)}`;
    if (viewOnce) url += `&view_once=true`;
    if (durationSecs && durationSecs > 0) url += `&duration_secs=${Math.round(durationSecs)}`;

    // Use FileSystem.uploadAsync (native multipart) instead of fetch + FormData.
    // The fetch + FormData approach with JS file objects triggers React Native's
    // "Unsupported FormDataPart implementation" bug on Android.
    // FileSystem.uploadAsync uses the native platform's HTTP client (OkHttp on
    // Android), bypassing the RN FormData polyfill entirely.
    //
    // The caller (ChatScreen) now writes audio recordings to the FileSystem cache
    // directory first, so they are accessible to FileInputStream (no sandbox issue).
    // Chat images are compressed to WebP client-side before upload. The server
    // sniffs the actual bytes (sharp) — this header only gates validation, and
    // WebP is on its allowlist either way.
    const mimeType =
      mediaType === 'image'
        ? 'image/webp'
        : mediaType === 'audio'
          ? 'audio/mp4'
          : mediaType === 'video'
            ? 'video/mp4'
            : 'application/octet-stream';

    const result = await Promise.race([
      FileSystem.uploadAsync(url, uri, {
        httpMethod: 'POST',
        uploadType: FileSystem.FileSystemUploadType.MULTIPART,
        fieldName: 'file',
        mimeType,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Upload timed out. Please try again.')), 120000),
      ),
    ]);

    let body: any;
    try {
      body = this.parseUploadBody(result.body, result.status);
    } catch (e: any) {
      throw new Error(e?.message || `Upload failed (HTTP ${result.status})`);
    }

    if (result.status >= 200 && result.status < 300) {
      return body;
    }

    // The server's error code rides along (e.g. CHAT_LOCKED), so the caller
    // can react to the reason rather than only show the text
    const error: Error & { code?: string } = new Error(
      body?.error?.message || `Upload failed (HTTP ${result.status})`,
    );
    if (body?.error?.code) error.code = body.error.code;
    throw error;
  }

  // ─── Mark One-Time View Media as Viewed ───────────────
  async markMediaViewed(mediaId: string): Promise<ApiResponse<{ viewedAt: string }>> {
    return this.request<{ viewedAt: string }>(`/api/v1/matches/media/${mediaId}/view`, {
      method: 'POST',
    });
  }

  // ─── Face Verification (on-device, self-reported) ───────
  /**
   * Report the result of the on-device face verification. The face matching
   * itself runs on the device (see services/faceVerification.ts) — the server
   * only records the outcome.
   */
  /** `skipped` marks the profile Face unverified even if an earlier selfie matched */
  async reportFaceVerification(payload: { verified: boolean; confidence?: number; skipped?: boolean }) {
    return this.request<{ status: string }>('/api/v1/users/face-verification', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }
}

export const api = new ApiClient();
export { API_URL, WS_URL };
