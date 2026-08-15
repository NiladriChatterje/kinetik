import * as SecureStore from 'expo-secure-store';
import * as FileSystem from 'expo-file-system/legacy';
import { API_URL, WS_URL } from '../config';

interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown; status?: number };
}

class ApiClient {
  private token: string | null = null;

  async init() {
    this.token = await SecureStore.getItemAsync('auth_token');
  }

  /** Returns the current auth token (used by photoService for native file uploads). */
  getToken(): string | null {
    return this.token;
  }

  setToken(token: string | null) {
    this.token = token;
    if (token) {
      SecureStore.setItemAsync('auth_token', token);
    } else {
      SecureStore.deleteItemAsync('auth_token');
    }
  }

  private async request<T>(
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
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch(`${API_URL}${endpoint}`, {
        ...options,
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeout);

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
        if (__DEV__) {
          console.error(`[API] Non-JSON response ${response.status} from ${endpoint}`);
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
          console.error(`[API] ${response.status} ${endpoint}:`, data);
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
        console.error(`[API] ${response.status} ${endpoint}:`, JSON.stringify(data));
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

      if (__DEV__) {
        console.error(`[API] Request failed ${endpoint}:`, error.message);
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
            message: 'Cannot reach server. Make sure you are on the same Wi-Fi and the backend is running.',
          },
        };
      }

      return {
        success: false,
        error: { code: 'NETWORK_ERROR', message: error.message || 'Network request failed' },
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
      if (response.ok) return { ok: true };
      return { ok: false, error: `Server returned ${response.status}` };
    } catch (e: any) {
      if (e.name === 'AbortError') return { ok: false, error: 'Connection timed out' };
      if (e instanceof TypeError) return { ok: false, error: 'Server unreachable' };
      return { ok: false, error: e.message || 'Connection failed' };
    }
  }

  // ─── Auth ───────────────────────────────────────────
  async register(data: { phone?: string; email?: string; password?: string; authProvider: string; authProviderId?: string; displayName?: string }) {
    return this.request<{ user: any; token: string }>('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async login(data: { phone?: string; email?: string; password?: string }) {
    return this.request<{ user?: any; token?: string; requiresOtp?: boolean; phone?: string; userId?: string }>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async sendOtp(phone: string) {
    return this.request<{ message: string }>('/api/v1/auth/send-otp', {
      method: 'POST',
      body: JSON.stringify({ phone }),
    });
  }

  async verifyOtp(phone: string, otp: string) {
    return this.request<{ user: any; token: string }>('/api/v1/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ phone, otp }),
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

  // ─── Windows ────────────────────────────────────────
  async getActiveWindows() {
    return this.request('/api/v1/windows/active');
  }

  async joinWindow(windowId: string) {
    return this.request(`/api/v1/windows/${windowId}/join`, { method: 'POST' });
  }

  async leaveWindow(windowId: string) {
    return this.request(`/api/v1/windows/${windowId}/leave`, { method: 'POST' });
  }

  // ─── Matches ────────────────────────────────────────
  async getMatches() {
    return this.request('/api/v1/matches');
  }

  // ─── Fans ───────────────────────────────────────────
  async getFans() {
    return this.request('/api/v1/fans');
  }

  async unlockFans() {
    return this.request('/api/v1/fans/unlock', { method: 'POST' });
  }

  // ─── Venues ─────────────────────────────────────────
  async getNearbyVenues(latitude: number, longitude: number, radius?: number) {
    return this.request(`/api/v1/venues/nearby?latitude=${latitude}&longitude=${longitude}&radius=${radius || 5}`);
  }

  // ─── Payments ───────────────────────────────────────
  async createPaymentOrder(amount: number, description?: string) {
    return this.request('/api/v1/payments/create-order', {
      method: 'POST',
      body: JSON.stringify({ amount, description }),
    });
  }

  /**
   * Creates a recurring Razorpay subscription (₹100/month premium plan).
   * Returns the subscription_id + razorpayKeyId needed to open the Checkout.
   */
  async createRazorpaySubscription() {
    return this.request<{
      subscriptionId: string;
      razorpayKeyId: string;
      amount: number;
      currency: string;
      period: string;
    }>('/api/v1/payments/subscription', { method: 'POST' });
  }

  /**
   * Verifies the Razorpay Checkout response for a subscription payment and
   * activates premium on the server when the signature checks out.
   */
  async verifyRazorpaySubscription(payload: {
    razorpayPaymentId: string;
    razorpaySubscriptionId: string;
    razorpaySignature: string;
  }) {
    return this.request<{
      verified: boolean;
      activated: boolean;
      tier?: string;
      expiresAt?: string;
      status?: string;
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
      subscriptionId: string | null;
    }>('/api/v1/payments/subscription/status');
  }

  /**
   * Cancels the recurring Razorpay subscription. The user keeps Premium until
   * the end of the current billing cycle, then it stops renewing.
   */
  async cancelRazorpaySubscription() {
    return this.request<{
      cancelled: boolean;
      status: string;
      subscriptionId: string;
      expiresAt: string | null;
    }>('/api/v1/payments/subscription/cancel', { method: 'POST' });
  }

  // ─── Duo Crew ───────────────────────────────────────
  async createDuoCrew() {
    return this.request('/api/v1/duo/create', { method: 'POST' });
  }

  async joinDuoCrew(code: string) {
    return this.request(`/api/v1/duo/join/${code}`, { method: 'POST' });
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
    return this.request<{ pushEnabled: boolean; flashWindowReminder: boolean }>('/api/v1/notifications/preferences');
  }

  async updateNotificationPreferences(data: { pushEnabled?: boolean; flashWindowReminder?: boolean }) {
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
    const token = this.getToken();
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

  async getKycStatus(): Promise<{
    kycStatus: string;
    latestDocument: {
      id: string;
      document_type: string;
      status: string;
      created_at: string;
    } | null;
  }> {
    const response = await this.request<{
      kycStatus: string;
      latestDocument: {
        id: string;
        document_type: string;
        status: string;
        created_at: string;
      } | null;
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

  // ─── Pose Verification ──────────────────────────────────
  // ─── Match / Swipe ────────────────────────────────────
  async getSwipeProfiles() {
    return this.request<{ profiles: any[] }>('/api/v1/matches/profiles');
  }

  async swipe(targetUserId: string, action: 'like' | 'pass' | 'super_like') {
    return this.request<{ matched: boolean; isSuperLike?: boolean; superLikesRemaining?: number; matchId?: string; partnerName?: string; partnerId?: string }>('/api/v1/matches/swipe', {
      method: 'POST',
      body: JSON.stringify({ targetUserId, action }),
    });
  }

  async getIncomingLikes() {
    return this.request<{ likes: any[]; totalCount: number }>('/api/v1/matches/likes');
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

  async getMessages(matchId: string) {
    return this.request<{ messages: any[] }>(`/api/v1/matches/conversations/${matchId}/messages`);
  }

  async sendMessage(matchId: string, content: string) {
    return this.request<{ id: string; matchId: string; senderId: string; content: string; createdAt: string; readAt: string | null }>(`/api/v1/matches/conversations/${matchId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
  }

  async sendMediaMessage(matchId: string, uri: string, mediaType: string, caption?: string, viewOnce?: boolean) {
    const token = this.getToken();
    let url = `${API_URL}/api/v1/matches/conversations/${matchId}/media?media_type=${mediaType}`;
    if (caption) url += `&caption=${encodeURIComponent(caption)}`;
    if (viewOnce) url += `&view_once=true`;

    // Use FileSystem.uploadAsync (native multipart) instead of fetch + FormData.
    // The fetch + FormData approach with JS file objects triggers React Native's
    // "Unsupported FormDataPart implementation" bug on Android.
    // FileSystem.uploadAsync uses the native platform's HTTP client (OkHttp on
    // Android), bypassing the RN FormData polyfill entirely.
    //
    // The caller (ChatScreen) now writes audio recordings to the FileSystem cache
    // directory first, so they are accessible to FileInputStream (no sandbox issue).
    const mimeType =
      mediaType === 'image'
        ? 'image/jpeg'
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

    throw new Error(body?.error?.message || `Upload failed (HTTP ${result.status})`);
  }

  // ─── 1:1 Voice/Video Calls (LiveKit) ─────────────────
  async getCallToken(matchId: string) {
    return this.request<{ url: string; token: string; room: string; expiresIn: number }>(
      `/api/v1/matches/${matchId}/call/token`,
      { method: 'POST' },
    );
  }

  // ─── Mark One-Time View Media as Viewed ───────────────
  async markMediaViewed(mediaId: string): Promise<ApiResponse<{ viewedAt: string }>> {
    return this.request<{ viewedAt: string }>(`/api/v1/matches/media/${mediaId}/view`, {
      method: 'POST',
    });
  }

  // ─── Pose Verification ──────────────────────────────────
  async submitPoseVerification(uri: string): Promise<{
    status: string;
    match: boolean;
    confidence: number;
    faceMatchScores: number[];
    message: string;
  }> {
    const token = this.getToken();
    const url = `${API_URL}/api/v1/users/pose-verification`;

    const result = await Promise.race([
      FileSystem.uploadAsync(url, uri, {
        httpMethod: 'POST',
        uploadType: FileSystem.FileSystemUploadType.MULTIPART,
        fieldName: 'photo',
        mimeType: 'image/jpeg',
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
}

export const api = new ApiClient();
export { API_URL, WS_URL };
