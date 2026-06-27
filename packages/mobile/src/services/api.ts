import * as SecureStore from 'expo-secure-store';
import * as FileSystem from 'expo-file-system/legacy';
import { API_URL, WS_URL } from '../config';

interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
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
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

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

      // Try to parse JSON — non-JSON responses (e.g. nginx 502) should not crash
      let data: any;
      try {
        data = await response.json();
      } catch {
        if (__DEV__) {
          console.error(`[API] Non-JSON response ${response.status} from ${endpoint}`);
        }
        return {
          success: false,
          error: {
            code: 'SERVER_ERROR',
            message: response.status === 502
              ? 'Server is unavailable. Please try again later.'
              : `Unexpected server response (${response.status})`,
          },
        };
      }

      if (!response.ok && __DEV__) {
        console.error(`[API] ${response.status} ${endpoint}:`, JSON.stringify(data));
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

  async createSubscription(tier: 'premium' | 'infinite', planDuration: 'monthly' | 'yearly' = 'monthly') {
    return this.request('/api/v1/payments/subscription', {
      method: 'POST',
      body: JSON.stringify({ tier, planDuration }),
    });
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
  /**
   * Delete a profile photo. Throws on failure so callers can handle errors.
   */
  async deletePhoto(photoId: string): Promise<void> {
    const response = await this.request(`/api/v1/users/photos/${photoId}`, {
      method: 'DELETE',
    });
    if (!response.success) {
      throw new Error(response.error?.message || 'Failed to delete photo');
    }
  }

  /**
   * Get all profile photos for the current user.
   */
  async getPhotos() {
    return this.request('/api/v1/users/photos');
  }

  /**
   * Set a photo as the primary profile photo.
   */
  async setPrimaryPhoto(photoId: string) {
    return this.request(`/api/v1/users/photos/${photoId}/primary`, {
      method: 'PUT',
    });
  }

  // ─── KYC Documents ────────────────────────────────────────
  /**
   * Upload a KYC identity document (PDF, JPG, PNG).
   * Uses native multipart upload with document_type field.
   */
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

    if (result.status >= 200 && result.status < 300) {
      const body = JSON.parse(result.body);
      return body.data;
    }

    let errorMessage = `Upload failed (HTTP ${result.status})`;
    try {
      const body = JSON.parse(result.body);
      errorMessage = body?.error?.message || errorMessage;
    } catch { /* non-JSON */ }
    throw new Error(errorMessage);
  }

  /**
   * Get the user's KYC status and latest document info.
   */
  async getKycStatus(): Promise<{
    kycStatus: string;
    latestDocument: {
      id: string;
      document_type: string;
      status: string;
      created_at: string;
    } | null;
  }> {
    const response = await this.request('/api/v1/kyc/status');
    if (!response.success) {
      throw new Error(response.error?.message || 'Failed to get KYC status');
    }
    return response.data!;
  }

  // ─── Area / Location Details ─────────────────────────────
  /**
   * Get the user's current area details (city, county, region, country, H3).
   */
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
    const response = await this.request('/api/v1/users/location/area');
    if (!response.success) {
      throw new Error(response.error?.message || 'Failed to get area details');
    }
    return response.data!;
  }

  // ─── Pose Verification ──────────────────────────────────
  /**
   * Submit a pose verification selfie photo for face matching
   * against the user's existing profile photos.
   * The selfie is NOT saved to MinIO — only used for verification.
   * Uses native multipart upload (same as photoService).
   */
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

    if (result.status >= 200 && result.status < 300) {
      const body = JSON.parse(result.body);
      return body.data;
    }

    let errorMessage = `Upload failed (HTTP ${result.status})`;
    try {
      const body = JSON.parse(result.body);
      errorMessage = body?.error?.message || errorMessage;
    } catch { /* non-JSON */ }
    throw new Error(errorMessage);
  }
}

export const api = new ApiClient();
export { API_URL, WS_URL };
