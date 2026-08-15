import { io, Socket } from 'socket.io-client';
import { WS_URL } from '../config';
import { api } from './api';

/**
 * App-wide shared /presence socket (likes badge, match popups, like list).
 * Screens attach/detach their own listeners; one connection per session.
 */
let socket: Socket | null = null;

export function getPresenceSocket(): Socket {
  // Recreate only when truly dead — `disconnected` is also true while
  // auto-reconnecting, and tearing down then would drop screen listeners
  if (!socket || !socket.active) {
    if (socket) {
      socket.removeAllListeners();
      socket.disconnect();
      socket = null;
    }

    socket = io(`${WS_URL}/presence`, {
      auth: { token: api.getToken() },
      transports: ['websocket'],
      forceNew: true,
    });

    let loggedConnectError = false;
    socket.on('connect', () => {
      loggedConnectError = false;
    });
    socket.on('connect_error', (err) => {
      if (!loggedConnectError) {
        loggedConnectError = true;
        console.warn('[PresenceSocket] Connection error (will keep retrying):', err.message);
      }
    });
  } else {
    (socket as any).auth = { token: api.getToken() };
  }
  return socket;
}

/** Tear down the shared socket (e.g. on logout). */
export function closePresenceSocket() {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}
