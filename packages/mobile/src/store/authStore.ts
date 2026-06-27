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
  errorCode?: string;
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

  // Like badge
  unreadLikeCount: number;
  fetchUnreadLikeCount: () => Promise<void>;

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
function getErrorResponse(response: {
  error?: { code?: string; message?: string; details?: unknown };
}): { message: string; code?: string } {
  const code = response.error?.code;
  const msg = response.error?.message;
  if (!msg || msg === 'Invalid input') {
    const details = response.error?.details as
      | { fieldErrors?: Record<string, string[]> }
      | undefined;
    const fieldErrors = details?.fieldErrors;
    if (fieldErrors) {
      const firstField = Object.keys(fieldErrors)[0];
      if (firstField && fieldErrors[firstField]?.length) {
        return { message: fieldErrors[firstField][0], code };
      }
    }
    return { message: 'Invalid phone or password.', code };
  }
  return { message: msg, code };
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
  unreadLikeCount: 0,

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
        // Fetch the user's profile to determine onboarding status on app restart
        const profileRes = await api.getProfile();
        if (profileRes.success && profileRes.data) {
          const d = profileRes.data as any;
          let onboardingStep = d.onboardingComplete ? 'complete' : (d.onboardingStep || 'splash');

          // If step would send user to the Photos screen, check if they already
          // have at least 2 photos and skip ahead to pose verification.
          if (!d.onboardingComplete && onboardingStep === 'location') {
            try {
              const photosRes = await api.getPhotos();
              if (photosRes.success && Array.isArray(photosRes.data) && photosRes.data.length >= 2) {
                onboardingStep = 'photos';
              }
            } catch {
              // Photos fetch failed — user will see the Photos screen
            }
          }

          set({
            token,
            user: {
              id: d.id,
              phone: d.phone,
              email: d.email,
              displayName: d.displayName,
              onboardingComplete: d.onboardingComplete,
              onboardingStep: d.onboardingStep,
            },
            isAuthenticated: true,
            onboardingStep,
            isLoading: false,
          });
        } else {
          // Profile fetch failed — token may be stale
          await SecureStore.deleteItemAsync('auth_token');
          api.setToken(null);
          set({ isLoading: false });
        }
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
      const { message } = getErrorResponse(response);
      return { success: false, error: message };
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
      const { message, code } = getErrorResponse(response);
      return { success: false, error: message, errorCode: code };
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
      const { message } = getErrorResponse(response);
      return { success: false, error: message };
    } catch (e: any) {
      return { success: false, error: e?.message || 'Failed to send verification code.' };
    }
  },

  verifyOtp: async (phone, otp) => {
    try {
      const response = await api.verifyOtp(phone, otp);
      if (response.success && response.data) {
        api.setToken(response.data.token);
        const userData = response.data.user as User;
        const onboardingComplete = userData?.onboardingComplete ?? false;

        let step = onboardingComplete ? 'complete' : 'splash';

        // If not marked complete, check actual profile data to determine real progress.
        // This handles users who filled in identity fields but never reached 'complete' step.
        if (!onboardingComplete) {
          try {
            const profileRes = await api.getProfile();
            if (profileRes.success && profileRes.data) {
              const d = profileRes.data as any;
              const hasIdentity = !!(d.dateOfBirth && d.gender && d.pronouns);

              if (hasIdentity) {
                // Identity data exists — use the stored onboarding step (which may be
                // ahead of 'splash'), or mark identity as completed so the screen
                // navigator skips the Identity screen.
                step = d.onboardingStep && d.onboardingStep !== 'splash'
                  ? d.onboardingStep
                  : 'identity';
              }

              // If step would send user to the Photos screen, check if they already
              // have at least 2 photos and skip ahead to pose verification.
              if (step === 'location') {
                try {
                  const photosRes = await api.getPhotos();
                  if (photosRes.success && Array.isArray(photosRes.data) && photosRes.data.length >= 2) {
                    step = 'photos';
                  }
                } catch {
                  // Photos fetch failed — user will see the Photos screen
                }
              }
            }
          } catch {
            // Profile fetch failed — fall back to the response flag
          }
        }

        set({
          user: userData,
          token: response.data.token,
          isAuthenticated: true,
          onboardingStep: step,
          pendingPhone: null,
          pendingUserId: null,
        });
        return { success: true };
      }
      const { message } = getErrorResponse(response);
      return { success: false, error: message };
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

  fetchUnreadLikeCount: async () => {
    try {
      const res = await api.getIncomingLikes();
      if (res.success && res.data) {
        set({ unreadLikeCount: res.data.totalCount || 0 });
      }
    } catch {
      // Silently fail
    }
  },

  setUser: (user) => set({ user }),
  setOnboardingStep: (step) => set({ onboardingStep: step }),
}));
