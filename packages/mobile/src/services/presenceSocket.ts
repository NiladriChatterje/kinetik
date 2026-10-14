import { Socket } from 'socket.io-client';
import { getNamespaceSocket } from './realtimeConnection';

/**
 * App-wide shared /presence socket (likes badge, match popups, like list).
 * Screens attach/detach their own listeners; one namespace per session, on
 * the single connection shared with /chat (see realtimeConnection.ts).
 */
let socket: Socket | null = null;

export function getPresenceSocket(): Socket {
  // The namespace socket is reused across the session and reconnected by
  // getNamespaceSocket() when truly dead. `disconnected` is also true while
  // auto-reconnecting, and tearing down then would drop screen listeners.
  const current = getNamespaceSocket('/presence');
  if (current !== socket) {
    socket = current;

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
