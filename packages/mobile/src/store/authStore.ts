import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { api } from '../services/api';

interface User {
  id: string;
  phone?: string;
  email?: string;
  displayName?: string;
  onboardingComplete?: boolean;
  onboardingStep?: string;
}

type ConnectionStatus = 'checking' | 'connected' | 'disconnected';

interface AuthResult {
  success: boolean;
  error?: string;
  requiresOtp?: boolean;
}

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  onboardingStep: string;
  connectionStatus: ConnectionStatus;
  connectionError: string | null;

  // OTP verification flow
  pendingPhone: string | null;
  pendingUserId: string | null;

  // Actions
  initialize: () => Promise<void>;
  checkConnection: () => Promise<void>;
  login: (phone: string, password: string) => Promise<AuthResult>;
  register: (data: { phone?: string; email?: string; password?: string; displayName?: string }) => Promise<AuthResult>;
  verifyOtp: (phone: string, otp: string) => Promise<AuthResult>;
  sendOtp: (phone: string) => Promise<AuthResult>;
  clearPendingOtp: () => void;
  logout: () => void;
  setUser: (user: User) => void;
  setOnboardingStep: (step: string) => void;
}

// Extract a user-friendly error message from the API response
function getErrorMessage(response: {
  error?: { message?: string; details?: unknown };
}): string {
  const msg = response.error?.message;
  if (!msg || msg === 'Invalid input') {
    const details = response.error?.details as
      | { fieldErrors?: Record<string, string[]> }
      | undefined;
    const fieldErrors = details?.fieldErrors;
    if (fieldErrors) {
      const firstField = Object.keys(fieldErrors)[0];
      if (firstField && fieldErrors[firstField]?.length) {
        return fieldErrors[firstField][0];
      }
    }
    return 'Invalid phone or password.';
  }
  return msg;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: true,
  onboardingStep: 'splash',
  connectionStatus: 'checking' as ConnectionStatus,
  connectionError: null,
  pendingPhone: null,
  pendingUserId: null,

  checkConnection: async () => {
    const prev = get().connectionStatus;
    if (prev === 'checking' || prev === 'connected') set({ connectionStatus: 'checking', connectionError: null });
    const result = await api.healthCheck();
    set({
      connectionStatus: result.ok ? 'connected' : 'disconnected',
      connectionError: result.ok ? null : result.error || 'Server unreachable',
    });
  },

  initialize: async () => {
    try {
      await api.init();
      const token = await SecureStore.getItemAsync('auth_token');
      if (token) {
        api.setToken(token);
        set({ token, isLoading: false });
      } else {
        set({ isLoading: false });
      }
    } catch {
      set({ isLoading: false });
    }
  },

  login: async (phone, password) => {
    try {
      const response = await api.login({ phone, password });
      if (response.success && response.data) {
        if (response.data.requiresOtp) {
          set({
            pendingPhone: phone,
            pendingUserId: response.data.userId || null,
          });
          return { success: true, requiresOtp: true };
        }
        api.setToken(response.data.token ?? null);
        set({
          user: response.data.user as User,
          token: response.data.token ?? null,
          isAuthenticated: true,
        });
        return { success: true };
      }
      return { success: false, error: getErrorMessage(response) };
    } catch (e: any) {
      return { success: false, error: e?.message || 'Unable to connect. Please try again.' };
    }
  },

  register: async (data) => {
    try {
      const response = await api.register({ ...data, authProvider: 'phone' });
      if (response.success && response.data) {
        return { success: true };
      }
      return { success: false, error: getErrorMessage(response) };
    } catch (e: any) {
      return { success: false, error: e?.message || 'Registration failed.' };
    }
  },

  sendOtp: async (phone) => {
    try {
      const response = await api.sendOtp(phone);
      if (response.success) {
        return { success: true };
      }
      return { success: false, error: getErrorMessage(response) };
    } catch (e: any) {
      return { success: false, error: e?.message || 'Failed to send verification code.' };
    }
  },

  verifyOtp: async (phone, otp) => {
    try {
      const response = await api.verifyOtp(phone, otp);
      if (response.success && response.data) {
        api.setToken(response.data.token);
        set({
          user: response.data.user as User,
          token: response.data.token,
          isAuthenticated: true,
          pendingPhone: null,
          pendingUserId: null,
        });
        return { success: true };
      }
      return { success: false, error: getErrorMessage(response) };
    } catch (e: any) {
      return { success: false, error: e?.message || 'Invalid verification code.' };
    }
  },

  clearPendingOtp: () => {
    set({ pendingPhone: null, pendingUserId: null });
  },

  logout: () => {
    api.setToken(null);
    set({
      user: null, token: null, isAuthenticated: false,
      onboardingStep: 'splash', pendingPhone: null, pendingUserId: null,
    });
  },

  setUser: (user) => set({ user }),
  setOnboardingStep: (step) => set({ onboardingStep: step }),
}));
