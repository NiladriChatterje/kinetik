import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

const API_URL = Constants.expoConfig?.extra?.apiUrl || 'http://localhost:3001';
const WS_URL = Constants.expoConfig?.extra?.wsUrl || 'http://localhost:3002';

if (typeof __DEV__ !== 'undefined' && __DEV__) {
  console.log('[API] Base URL:', API_URL);
  console.log('[API] WS URL:', WS_URL);
}

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
    return this.request('/api/v1/users/location', {
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
   * Upload a profile photo via multipart/form-data.
   * Does NOT use the standard request() method because FormData needs
   * a different Content-Type (multipart) and no JSON body.
   */
  async uploadPhoto(
    formData: FormData,
  ): Promise<{ id: string; url: string; thumbnailUrl: string }> {
    const headers: Record<string, string> = {};
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000); // 60s for uploads

    try {
      const response = await fetch(`${API_URL}/api/v1/users/photos`, {
        method: 'POST',
        headers,
        body: formData,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error?.message || 'Upload failed');
      }
      return data.data;
    } catch (error: any) {
      clearTimeout(timeout);
      if (error.name === 'AbortError') {
        throw new Error('Upload timed out. Please try again.');
      }
      throw error;
    }
  }

  /**
   * Delete a profile photo.
   */
  async deletePhoto(photoId: string): Promise<void> {
    await this.request(`/api/v1/users/photos/${photoId}`, {
      method: 'DELETE',
    });
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
}

export const api = new ApiClient();
export { API_URL, WS_URL };
