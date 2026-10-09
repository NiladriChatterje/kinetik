import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import Toast from 'react-native-toast-message';
import { Socket } from 'socket.io-client';
import { api, OtpTarget } from '../services/api';
import { closeChatSocket, getChatSocket } from '../services/chatSocket';
import { closePresenceSocket, getPresenceSocket } from '../services/presenceSocket';
import { isWelcomePending } from '../services/welcomeNotice';

// Badge listeners attached to the shared /chat socket, kept for detaching
let chatsSocketHandlers: {
  socket: Socket;
  joinAllRooms: () => void;
  onChatMessage: (data: any) => void;
  onMatchNew: (data: any) => void;
} | null = null;

// ─── Session snapshot ────────────────────────────────────────
// The last known user + onboarding step, written whenever they change while
// signed in. On launch, if the server cannot be reached to confirm the
// session, the app restores from this instead of showing the login screen.
// The tokens themselves live under 'auth_token' / 'refresh_token' in api.ts.
const SESSION_SNAPSHOT_KEY = 'auth_session';

interface SessionSnapshot {
  user: User;
  onboardingStep: string;
}

async function readSessionSnapshot(): Promise<SessionSnapshot | null> {
  try {
    const raw = await SecureStore.getItemAsync(SESSION_SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.user?.id || typeof parsed.onboardingStep !== 'string') return null;
    return parsed as SessionSnapshot;
  } catch {
    return null;
  }
}

function writeSessionSnapshot(snapshot: SessionSnapshot | null): void {
  try {
    if (snapshot) {
      SecureStore.setItemAsync(SESSION_SNAPSHOT_KEY, JSON.stringify(snapshot));
    } else {
      SecureStore.deleteItemAsync(SESSION_SNAPSHOT_KEY);
    }
  } catch {
    // Storage hiccup; the next change will try again.
  }
}

// Bookkeeping for the chat badge: the badge counts DISTINCT conversations
// (users) with unseen messages, so track which matchIds have already been
// counted by the live socket handler. Rebuilt from server truth by
// fetchUnreadChatCount, cleared by resetUnreadChatCount/logout.
let countedUnreadMatchIds = new Set<string>();

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
  /** The one-time Welcome page is still waiting to be seen (services/welcomeNotice.ts) */
  welcomePending: boolean;
  connectionStatus: ConnectionStatus;
  connectionError: string | null;

  // OTP verification flow — the code goes to whichever of these is set
  pendingEmail: string | null;
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

  // Which DM conversation is currently open (ChatScreen sets this).
  // ChatListScreen uses it to skip inflating the unread count for
  // messages the user is actively viewing.
  openChatMatchId: string | null;
  setOpenChatMatchId: (matchId: string | null) => void;

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
  login: (credentials: { email?: string; phone?: string }, password: string) => Promise<AuthResult>;
  register: (data: { phone?: string; email?: string; password?: string; displayName?: string; countryCode?: string; city?: string; stateCode?: string }) => Promise<AuthResult>;
  verifyOtp: (target: OtpTarget, otp: string) => Promise<AuthResult>;
  sendOtp: (target: OtpTarget) => Promise<AuthResult>;
  clearPendingOtp: () => void;
  logout: () => void;
  deleteAccount: () => Promise<AuthResult>;
  setUser: (user: User) => void;
  setOnboardingStep: (step: string) => void;
  setWelcomePending: (pending: boolean) => void;
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
    return { message: 'Invalid email or password.', code };
  }
  return { message: msg, code };
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: true,
  onboardingStep: 'splash',
  welcomePending: false,
  connectionStatus: 'checking' as ConnectionStatus,
  connectionError: null,
  pendingEmail: null,
  pendingPhone: null,
  pendingUserId: null,
  unreadLikeCount: 0,
  unreadChatCount: 0,
  openChatMatchId: null,
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
          // have at least 2 photos and skip ahead to face verification.
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

          // Closed the app on the Welcome page last time: show it again
          const welcomePending = d.onboardingComplete ? await isWelcomePending(d.id) : false;

          set({
            token,
            welcomePending,
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
          // the server explicitly rejected the token (401/403), or when the
          // token is perfectly valid but the account behind it is gone (404):
          // the user deleted their account elsewhere, or the database the API
          // talks to was replaced. A 502/5xx from a gateway or a network error
          // means the server is temporarily unavailable — keep the token so a
          // transient outage doesn't log the user out (the offline banner
          // covers that UX).
          const status = profileRes.error?.status;
          const isAuthFailure =
            profileRes.error?.code === 'UNAUTHORIZED' ||
            status === 401 ||
            status === 403;
          // USER_NOT_FOUND has already signed out through api.onAccountMissing.
          // NOT_FOUND is what servers from before that code still send. A bare
          // 404 is not enough: a misrouted proxy answers 404 too.
          const code = profileRes.error?.code;
          const isMissingAccount = code === 'USER_NOT_FOUND' || code === 'NOT_FOUND';

          if (isMissingAccount) {
            signOutMissingAccount();
          } else if (isAuthFailure) {
            // setToken/setRefreshToken clear SecureStore *and* the in-memory
            // copy the client sends on every request.
            api.setToken(null);
            api.setRefreshToken(null);
            set({
              user: null,
              token: null,
              isAuthenticated: false,
              onboardingStep: 'splash',
            });
          } else {
            // Transient failure (5xx, timeout, no network, database waking
            // up). The token was kept above; keep the session too. Restore the
            // last known user so the app opens where it left off instead of
            // on the login screen. Screens refetch their own data and the
            // connection banner covers the outage.
            const snapshot = await readSessionSnapshot();
            if (snapshot) {
              set({
                token,
                user: snapshot.user,
                isAuthenticated: true,
                onboardingStep: snapshot.onboardingStep,
                isLoading: false,
              });
              get().connectLikesSocket();
              get().connectChatsSocket();
              return;
            }
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

  login: async (credentials, password) => {
    try {
      const response = await api.login({ ...credentials, password });
      if (response.success && response.data) {
        if (response.data.requiresOtp) {
          set({
            pendingEmail: credentials.email ?? null,
            pendingPhone: credentials.phone ?? null,
            pendingUserId: response.data.userId || null,
          });
          return { success: true, requiresOtp: true };
        }
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
      const response = await api.register({ ...data, authProvider: data.email ? 'email' : 'phone' });
      if (response.success && response.data) {
        return { success: true };
      }
      const { message, code } = getErrorResponse(response);
      return { success: false, error: message, errorCode: code };
    } catch (e: any) {
      return { success: false, error: e?.message || 'Registration failed.' };
    }
  },

  sendOtp: async (target) => {
    try {
      const response = await api.sendOtp(target);
      if (response.success) {
        return { success: true };
      }
      const { message } = getErrorResponse(response);
      return { success: false, error: message };
    } catch (e: any) {
      return { success: false, error: e?.message || 'Failed to send verification code.' };
    }
  },

  verifyOtp: async (target, otp) => {
    try {
      const response = await api.verifyOtp(target, otp);
      if (response.success && response.data) {
        api.setToken(response.data.token);
        api.setRefreshToken(response.data.refreshToken ?? null);
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
              // have at least 2 photos and skip ahead to face verification.
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
          pendingEmail: null,
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
    set({ pendingEmail: null, pendingPhone: null, pendingUserId: null });
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

    // Shared app-wide /chat socket (also used by the chat screens) — attach
    // badge listeners, don't open another connection
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

    // Real-time incoming message -> unread badge count. Counts DISTINCT
    // conversations with unseen messages ("how many users"), not messages:
    // a conversation already counted is not counted again until the badge is
    // reset or re-synced from the server.
    const onChatMessage = (data: any) => {
      if (!data || data.senderId === get().user?.id) return;
      if (countedUnreadMatchIds.has(data.matchId)) return;
      countedUnreadMatchIds.add(data.matchId);
      set({ unreadChatCount: countedUnreadMatchIds.size });
    };

    // A new match opens a new chat room — join it so its messages arrive
    // here, and re-sync the badge from the server: a fresh match ships an
    // opening-line message from the other side, which may have been
    // broadcast before this client joined the new room.
    const onMatchNew = (data: any) => {
      if (data?.matchId) socket.emit('chat:join', { matchId: data.matchId });
      get().fetchUnreadChatCount();
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
    // torn down by closeChatSocket() in logout/deleteAccount
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
        // Badge = number of distinct conversations (users) with at least one
        // unseen message — not the total count of unseen messages.
        const unreadConvs = res.data.conversations.filter(
          (conv: any) => (conv.unreadCount || 0) > 0,
        );
        countedUnreadMatchIds = new Set(unreadConvs.map((conv: any) => conv.matchId));
        set({ unreadChatCount: unreadConvs.length });
      }
    } catch {
      // Silently fail
    }
  },

  resetUnreadChatCount: () => {
    countedUnreadMatchIds.clear();
    set({ unreadChatCount: 0 });
  },

  setOpenChatMatchId: (matchId: string | null) => {
    set({ openChatMatchId: matchId });
  },

  logout: () => {
    get().disconnectLikesSocket();
    get().disconnectChatsSocket();
    closeChatSocket();
    countedUnreadMatchIds.clear();
    api.setToken(null);
    api.setRefreshToken(null);
    set({
      user: null, token: null, isAuthenticated: false,
      onboardingStep: 'splash', pendingEmail: null, pendingPhone: null, pendingUserId: null,
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
        closeChatSocket();
        countedUnreadMatchIds.clear();
        api.setToken(null);
        api.setRefreshToken(null);
        set({
          user: null, token: null, isAuthenticated: false,
          onboardingStep: 'splash', pendingEmail: null, pendingPhone: null, pendingUserId: null,
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
  setWelcomePending: (pending) => set({ welcomePending: pending }),
}));

// The token is valid but its account is gone: deleted elsewhere, or the API now
// talks to a different database. Sign out right away, wherever the user is.
// Several requests in flight can all come back USER_NOT_FOUND; the first one
// clears the token, which makes the rest no-ops.
function signOutMissingAccount(): void {
  if (!api.getToken()) return;
  useAuthStore.getState().logout();
  Toast.show({
    type: 'glass',
    text1: 'Account not found',
    text2: "This account doesn't exist anymore. You've been signed out.",
    visibilityTime: 4000,
  });
}

api.onAccountMissing(signOutMissingAccount);

// Keep the on-device session snapshot in step with the store: written while
// signed in, removed on sign out or account deletion. Doing it here, rather
// than in every action that touches these fields, means no path is missed.
useAuthStore.subscribe((state, prev) => {
  if (
    state.isAuthenticated === prev.isAuthenticated &&
    state.user === prev.user &&
    state.onboardingStep === prev.onboardingStep
  ) {
    return;
  }
  if (state.isAuthenticated && state.user) {
    writeSessionSnapshot({ user: state.user, onboardingStep: state.onboardingStep });
  } else if (!state.isAuthenticated) {
    writeSessionSnapshot(null);
  }
});
