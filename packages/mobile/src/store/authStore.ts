import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { Socket } from 'socket.io-client';
import { api } from '../services/api';
import { closeCallSocket, getChatSocket } from '../services/callSocket';
import { closePresenceSocket, getPresenceSocket } from '../services/presenceSocket';

// Badge listeners attached to the shared /chat socket, kept for detaching
let chatsSocketHandlers: {
  socket: Socket;
  joinAllRooms: () => void;
  onChatMessage: (data: any) => void;
  onMatchNew: (data: any) => void;
} | null = null;

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
  resetUnreadLikeCount: () => void;

  // Chat badge
  unreadChatCount: number;
  fetchUnreadChatCount: () => Promise<void>;
  resetUnreadChatCount: () => void;

  // Socket for real-time like/match updates
  likesSocket: Socket | null;
  connectLikesSocket: () => void;
  disconnectLikesSocket: () => void;

  // Socket for real-time chat updates
  chatSocket: Socket | null;
  connectChatsSocket: () => void;
  disconnectChatsSocket: () => void;

  // Actions
  initialize: () => Promise<void>;
  checkConnection: () => Promise<void>;
  login: (phone: string, password: string) => Promise<AuthResult>;
  register: (data: { phone?: string; email?: string; password?: string; displayName?: string }) => Promise<AuthResult>;
  verifyOtp: (phone: string, otp: string) => Promise<AuthResult>;
  sendOtp: (phone: string) => Promise<AuthResult>;
  clearPendingOtp: () => void;
  logout: () => void;
  deleteAccount: () => Promise<AuthResult>;
  setUser: (user: User) => void;
  setOnboardingStep: (step: string) => void;
}

// Extract a user-friendly error message from the API response
function getErrorResponse(response: {
  error?: { code?: string; message?: string; details?: unknown };
}): { message: string; code?: string } {
  const code = response.error?.code;
  // Safety net: never let a raw HTTP status / technical string (e.g. "401" or
  // "HTTP 401 Unauthorized") become the message shown to the user — fall back
  // to friendly copy below.
  const rawMsg = response.error?.message;
  const msg = rawMsg && /HTTP\s*\d{3}|^\s*\d{3}\s*$/i.test(rawMsg) ? undefined : rawMsg;
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
  unreadChatCount: 0,
  likesSocket: null,
  chatSocket: null,

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

          // Connect real-time sockets for like/match and chat updates
          get().connectLikesSocket();
          get().connectChatsSocket();
          // Fetch pending counts for the badges
          get().fetchUnreadLikeCount();
          get().fetchUnreadChatCount();
        } else {
          // Profile fetch failed. Only treat it as a stale/expired session when
          // the server explicitly rejected the token (401/403). A 502/5xx from
          // a gateway or a network error means the server is temporarily
          // unavailable — keep the token so a transient outage doesn't log the
          // user out (the offline banner covers that UX).
          const status = profileRes.error?.status;
          const isAuthFailure =
            profileRes.error?.code === 'UNAUTHORIZED' ||
            status === 401 ||
            status === 403;
          if (isAuthFailure) {
            await SecureStore.deleteItemAsync('auth_token');
            api.setToken(null);
          }
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

        // Connect real-time sockets for like/match and chat updates
        get().connectLikesSocket();
        get().connectChatsSocket();
        return { success: true };
      }
      const { message, code } = getErrorResponse(response);
      return { success: false, error: message, errorCode: code };
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

        // Connect real-time sockets for like/match and chat updates
        get().connectLikesSocket();
        get().connectChatsSocket();
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

  connectLikesSocket: () => {
    const { user, likesSocket } = get();
    if (!user || likesSocket) return;

    const token = api.getToken();
    if (!token) return;

    // Shared app-wide /presence socket — attach the badge listener to it
    // instead of opening a dedicated connection
    const socket = getPresenceSocket();

    socket.on('likes:new', (data: any) => {
      console.log('[LikesSocket] New like received:', data.likedByName);
      const current = get().unreadLikeCount;
      set({ unreadLikeCount: current + 1 });
    });

    set({ likesSocket: socket });
  },

  disconnectLikesSocket: () => {
    const { likesSocket } = get();
    if (likesSocket) {
      closePresenceSocket();
      set({ likesSocket: null });
    }
  },

  connectChatsSocket: () => {
    const { user, chatSocket } = get();
    if (!user || chatSocket) return;

    const token = api.getToken();
    if (!token) return;

    // Shared app-wide /chat socket (also used by call signaling and the chat
    // screens) — attach badge listeners, don't open another connection
    const socket = getChatSocket();

    // Join every conversation room so incoming messages reach this socket.
    // Re-runs on every (re)connect because rooms are per-socket on the server.
    const joinAllRooms = async () => {
      try {
        const res = await api.getConversations();
        const convs = res.data?.conversations || [];
        convs.forEach((conv: any) => socket.emit('chat:join', { matchId: conv.matchId }));
      } catch {
        // Silent — the socket retries joining on the next connect event
      }
    };

    // Real-time incoming message -> unread badge count
    const onChatMessage = (data: any) => {
      if (!data || data.senderId === get().user?.id) return;
      const current = get().unreadChatCount;
      set({ unreadChatCount: current + 1 });
    };

    // A new match opens a new chat room — join it so its messages arrive here
    const onMatchNew = (data: any) => {
      if (data?.matchId) socket.emit('chat:join', { matchId: data.matchId });
    };

    socket.on('connect', joinAllRooms);
    socket.on('chat:message', onChatMessage);
    socket.on('match:new', onMatchNew);
    if (socket.connected) joinAllRooms();

    chatsSocketHandlers = { socket, joinAllRooms, onChatMessage, onMatchNew };
    set({ chatSocket: socket });
  },

  disconnectChatsSocket: () => {
    // Detach only the badge listeners — the shared /chat socket itself is
    // torn down by closeCallSocket() in logout/deleteAccount
    if (chatsSocketHandlers) {
      const { socket, joinAllRooms, onChatMessage, onMatchNew } = chatsSocketHandlers;
      socket.off('connect', joinAllRooms);
      socket.off('chat:message', onChatMessage);
      socket.off('match:new', onMatchNew);
      chatsSocketHandlers = null;
    }
    set({ chatSocket: null });
  },

  fetchUnreadChatCount: async () => {
    try {
      const res = await api.getConversations();
      if (res.success && res.data?.conversations) {
        const total = res.data.conversations.reduce(
          (sum: number, conv: any) => sum + (conv.unreadCount || 0),
          0,
        );
        set({ unreadChatCount: total });
      }
    } catch {
      // Silently fail
    }
  },

  resetUnreadChatCount: () => set({ unreadChatCount: 0 }),

  logout: () => {
    get().disconnectLikesSocket();
    get().disconnectChatsSocket();
    closeCallSocket();
    api.setToken(null);
    set({
      user: null, token: null, isAuthenticated: false,
      onboardingStep: 'splash', pendingPhone: null, pendingUserId: null,
      unreadLikeCount: 0, unreadChatCount: 0,
    });
  },

  // Permanently deletes the account server-side, then wipes all local
  // auth state (same reset as logout) so the app returns to onboarding.
  deleteAccount: async () => {
    try {
      const response = await api.deleteAccount();
      if (response.success) {
        get().disconnectLikesSocket();
        get().disconnectChatsSocket();
        closeCallSocket();
        api.setToken(null);
        set({
          user: null, token: null, isAuthenticated: false,
          onboardingStep: 'splash', pendingPhone: null, pendingUserId: null,
          unreadLikeCount: 0, unreadChatCount: 0,
        });
        return { success: true };
      }
      const { message, code } = getErrorResponse(response);
      return { success: false, error: message, errorCode: code };
    } catch (e: any) {
      return { success: false, error: e?.message || 'Failed to delete account.' };
    }
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

  resetUnreadLikeCount: () => set({ unreadLikeCount: 0 }),

  setUser: (user) => set({ user }),
  setOnboardingStep: (step) => set({ onboardingStep: step }),
}));
