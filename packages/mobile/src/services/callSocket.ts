import { io, Socket } from 'socket.io-client';
import { WS_URL } from '../config';
import { api } from './api';

/**
 * Shared singleton connection to the `/chat` namespace used for 1:1 call
 * signaling (LiveKit). The realtime ChatHandler routes `call:*` events to the
 * target user's PERSONAL room (`user:<id>`), which every socket joins on
 * connect — so a persistent socket here receives incoming-call invites no
 * matter which screen the user is on.
 *
 * Unlike the vibe socket (which must stay alive across two screens), this one
 * lives for the whole authenticated session and is only torn down on logout.
 */
export const CALL_EVENTS = {
  INVITE: 'call:invite',
  ACCEPT: 'call:accept',
  DECLINE: 'call:decline',
  CANCEL: 'call:cancel',
  BUSY: 'call:busy',
} as const;

export const CALL_ACTIVE_JOIN = 'call:active_join';
export const CALL_ACTIVE_LEAVE = 'call:active_leave';

export interface CallInvitePayload {
  matchId: string;
  callerId: string;
  callerName: string;
  callerPhotoUrl?: string;
  timestamp: string;
}

let socket: Socket | null = null;
const listeners = new Map<string, Set<(data: any) => void>>();

function dispatch(event: string, data: any) {
  listeners.get(event)?.forEach((cb) => {
    try {
      cb(data);
    } catch (err) {
      console.error(`[CallSocket] Listener error on ${event}:`, err);
    }
  });
}

export function getCallSocket(): Socket {
  if (!socket || socket.disconnected) {
    if (socket) {
      socket.removeAllListeners();
      socket.disconnect();
      socket = null;
    }

    const token = api.getToken();
    socket = io(`${WS_URL}/chat`, {
      auth: { token },
      transports: ['websocket'],
      forceNew: true,
    });

    socket.on('connect', () => {
      console.log('[CallSocket] Connected');
    });
    socket.on('connect_error', (err) => {
      console.error('[CallSocket] Connection error:', err.message);
    });
    socket.on('disconnect', (reason) => {
      console.log('[CallSocket] Disconnected:', reason);
    });

    // Forward all call signaling events to subscribers
    Object.values(CALL_EVENTS).forEach((event) => {
      socket!.on(event, (data: any) => dispatch(event, data));
    });
  }
  return socket;
}

/** Subscribe to a call signaling event. Returns an unsubscribe function. */
export function onCallEvent(event: string, cb: (data: any) => void): () => void {
  getCallSocket(); // ensure connected
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event)!.add(cb);
  return () => listeners.get(event)?.delete(cb);
}

/** Emit only after the connection is ready (connect fires async). */
export function emitWhenConnected(socket: Socket, event: string, data: unknown) {
  if (socket.connected) {
    socket.emit(event, data);
  } else {
    socket.once('connect', () => socket.emit(event, data));
  }
}

/**
 * Ensure the socket has joined the match room. The realtime server only
 * forwards `call:invite` from users who joined the match via `chat:join`,
 * so the caller must join before inviting.
 */
export function joinMatchForCall(matchId: string) {
  emitWhenConnected(getCallSocket(), 'chat:join', { matchId });
}

/** Caller → callee: ring. */
export function emitCallInvite(matchId: string, partnerId: string, callerName: string, callerPhotoUrl?: string) {
  joinMatchForCall(matchId);
  emitWhenConnected(getCallSocket(), CALL_EVENTS.INVITE, {
    matchId,
    partnerId,
    callerName,
    callerPhotoUrl,
  });
}

/** Callee → caller: accepted, joining the room. */
export function emitCallAccept(matchId: string, callerId: string) {
  emitWhenConnected(getCallSocket(), CALL_EVENTS.ACCEPT, { matchId, callerId });
}

/** Callee → caller: declined. */
export function emitCallDecline(matchId: string, callerId: string) {
  emitWhenConnected(getCallSocket(), CALL_EVENTS.DECLINE, { matchId, callerId });
}

/** Caller → callee: hung up while ringing. */
export function emitCallCancel(matchId: string, partnerId: string) {
  emitWhenConnected(getCallSocket(), CALL_EVENTS.CANCEL, { matchId, partnerId });
}

/** Mark this user as in an active 1:1 call — the server replies call:busy to other callers. */
export function emitJoinActiveCall() {
  emitWhenConnected(getCallSocket(), CALL_ACTIVE_JOIN, {});
}

/** Clear the in-call flag — the server will ring this user again. */
export function emitLeaveActiveCall() {
  emitWhenConnected(getCallSocket(), CALL_ACTIVE_LEAVE, {});
}

/** Tear down the shared socket (e.g. on logout). */
export function closeCallSocket() {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
  listeners.clear();
}
