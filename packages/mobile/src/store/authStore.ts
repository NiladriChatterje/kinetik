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
}

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  onboardingStep: string;
  connectionStatus: ConnectionStatus;
  connectionError: string | null;

  // Actions
  initialize: () => Promise<void>;
  checkConnection: () => Promise<void>;
  login: (phone: string, password: string) => Promise<AuthResult>;
  register: (data: { phone?: string; email?: string; password?: string; displayName?: string }) => Promise<AuthResult>;
  verifyOtp: (phone: string, otp: string) => Promise<AuthResult>;
  logout: () => void;
  setUser: (user: User) => void;
  setOnboardingStep: (step: string) => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: true,
  onboardingStep: 'splash',
  connectionStatus: 'checking' as ConnectionStatus,
  connectionError: null,

  checkConnection: async () => {
    const prev = get().connectionStatus;
    // On first run show 'checking'; on retry keep current status to avoid banner flicker
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
        set({ token, isAuthenticated: true, isLoading: true });
        const response = await api.getProfile();
        if (response.success && response.data) {
          set({
            user: response.data as User,
            isAuthenticated: true,
            isLoading: false,
            onboardingStep: (response.data as any).onboardingStep || 'splash',
          });
        } else {
          set({ isAuthenticated: false, isLoading: false, token: null });
        }
      } else {
        set({ isLoading: false });
      }
    } catch {
      set({ isLoading: false });
    }
  },

  login: async (phone, password) => {
    const response = await api.login({ phone, password });
    if (response.success && response.data) {
      api.setToken(response.data.token);
      set({
        user: response.data.user as User,
        token: response.data.token,
        isAuthenticated: true,
      });
      return { success: true };
    }
    return { success: false, error: response.error?.message || 'Invalid phone or password.' };
  },

  register: async (data) => {
    const response = await api.register({ ...data, authProvider: 'phone' });
    if (response.success && response.data) {
      api.setToken(response.data.token);
      set({
        user: response.data.user as User,
        token: response.data.token,
        isAuthenticated: true,
      });
      return { success: true };
    }
    return { success: false, error: response.error?.message || 'Registration failed.' };
  },

  verifyOtp: async (phone, otp) => {
    const response = await api.verifyOtp(phone, otp);
    if (response.success && response.data) {
      api.setToken(response.data.token);
      set({
        user: response.data.user as User,
        token: response.data.token,
        isAuthenticated: true,
      });
      return { success: true };
    }
    return { success: false, error: response.error?.message || 'Invalid verification code.' };
  },

  logout: () => {
    api.setToken(null);
    set({ user: null, token: null, isAuthenticated: false, onboardingStep: 'splash' });
  },

  setUser: (user) => set({ user }),
  setOnboardingStep: (step) => set({ onboardingStep: step }),
}));
