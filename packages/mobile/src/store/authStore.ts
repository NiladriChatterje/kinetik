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

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  onboardingStep: string;

  // Actions
  initialize: () => Promise<void>;
  login: (phone: string, password: string) => Promise<boolean>;
  register: (data: { phone?: string; email?: string; password?: string }) => Promise<boolean>;
  verifyOtp: (phone: string, otp: string) => Promise<boolean>;
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
      return true;
    }
    return false;
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
      return true;
    }
    return false;
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
      return true;
    }
    return false;
  },

  logout: () => {
    api.setToken(null);
    set({ user: null, token: null, isAuthenticated: false, onboardingStep: 'splash' });
  },

  setUser: (user) => set({ user }),
  setOnboardingStep: (step) => set({ onboardingStep: step }),
}));
