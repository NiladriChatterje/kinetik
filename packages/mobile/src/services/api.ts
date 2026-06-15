import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

const API_URL = Constants.expoConfig?.extra?.apiUrl || 'http://localhost:3001';
const WS_URL = Constants.expoConfig?.extra?.wsUrl || 'http://localhost:3002';

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

    try {
      const response = await fetch(`${API_URL}${endpoint}`, {
        ...options,
        headers,
      });

      const data = await response.json();
      return data as ApiResponse<T>;
    } catch (error: any) {
      return {
        success: false,
        error: { code: 'NETWORK_ERROR', message: error.message || 'Network request failed' },
      };
    }
  }

  // ─── Auth ───────────────────────────────────────────
  async register(data: { phone?: string; email?: string; password?: string; authProvider: string; authProviderId?: string }) {
    return this.request<{ user: any; token: string }>('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async login(data: { phone?: string; email?: string; password?: string }) {
    return this.request<{ user: any; token: string }>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
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

  // ─── Interests ──────────────────────────────────────
  async getInterests() {
    return this.request('/api/v1/users/interests');
  }
}

export const api = new ApiClient();
export { API_URL, WS_URL };
