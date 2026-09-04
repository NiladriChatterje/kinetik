import { io, Socket } from 'socket.io-client';
import { WS_URL } from '../config';
import { api } from './api';

/**
 * App-wide shared connection to the `/chat` namespace. Chat screens and the
 * unread badge attach their own listeners here instead of opening extra
 * connections per screen. Every socket joins its PERSONAL room (`user:<id>`)
 * on connect, so this one connection receives new-match and message events no
 * matter which screen the user is on.
 *
 * It lives for the whole authenticated session and is only torn down on
 * logout / account deletion.
 */

let socket: Socket | null = null;

export function getChatSocket(): Socket {
  // Recreate only when truly dead (never created, or manually closed).
  // `disconnected` is also true mid-auto-reconnect — tearing down then would
  // silently drop every listener other screens attached to this socket.
  if (!socket || !socket.active) {
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

    let loggedConnectError = false;
    socket.on('connect', () => {
      loggedConnectError = false;
      console.log('[ChatSocket] Connected');
    });
    socket.on('connect_error', (err) => {
      if (!loggedConnectError) {
        loggedConnectError = true;
        console.warn('[ChatSocket] Connection error (will keep retrying):', err.message);
      }
    });
    socket.on('disconnect', (reason) => {
      console.log('[ChatSocket] Disconnected:', reason);
    });
  } else {
    // Reused — make sure reconnection attempts carry the current token
    (socket as any).auth = { token: api.getToken() };
  }
  return socket;
}

/** Tear down the shared socket (e.g. on logout). */
export function closeChatSocket() {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}
