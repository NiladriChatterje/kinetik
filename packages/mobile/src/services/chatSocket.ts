import { Socket } from 'socket.io-client';
import { getNamespaceSocket } from './realtimeConnection';

/**
 * App-wide shared `/chat` namespace. Chat screens and the unread badge attach
 * their own listeners here instead of opening extra connections per screen.
 * Every socket joins its PERSONAL room (`user:<id>`) on connect, so this one
 * namespace receives new-match and message events no matter which screen the
 * user is on.
 *
 * It rides on the single connection shared with /presence (see
 * realtimeConnection.ts), lives for the whole authenticated session and is
 * only torn down on logout / account deletion.
 */

let socket: Socket | null = null;

export function getChatSocket(): Socket {
  // The namespace socket is reused across the session and reconnected by
  // getNamespaceSocket() when truly dead (manually closed, or the token was
  // rejected). `disconnected` is also true mid-auto-reconnect — tearing down
  // then would silently drop every listener other screens attached.
  const current = getNamespaceSocket('/chat');
  if (current !== socket) {
    socket = current;

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
