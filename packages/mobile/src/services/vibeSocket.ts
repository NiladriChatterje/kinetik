import { io, Socket } from 'socket.io-client';
import { WS_URL } from '../config';
import { api } from './api';

/**
 * Shared singleton connection to the `/vibe-check` namespace.
 *
 * The VibeCheckScreen → CommitmentGateScreen transition MUST keep one socket
 * alive: the realtime `vibeCheck` handler deletes the active check and emits
 * `vibe:end {reason:'disconnect'}` when a user's socket disconnects. If each
 * screen opened its own `forceNew` socket and disconnected it on unmount, the
 * check would be destroyed mid-flow. So we share a single connection and only
 * close it when the flow truly ends (leaving to Main or LockStatus).
 */
let socket: Socket | null = null;

export function getVibeSocket(): Socket {
  // Recreate if the previous socket was closed (dead reference) — otherwise
  // emitWhenConnected would wait forever for a `connect` that never fires.
  if (!socket || socket.disconnected) {
    if (socket) {
      socket.removeAllListeners();
      socket.disconnect();
      socket = null;
    }

    const token = api.getToken();
    socket = io(`${WS_URL}/vibe-check`, {
      auth: { token },
      transports: ['websocket'],
      forceNew: true,
    });

    let loggedConnectError = false;
    socket.on('connect', () => {
      loggedConnectError = false;
      console.log('[VibeSocket] Connected');
    });
    socket.on('connect_error', (err) => {
      if (!loggedConnectError) {
        loggedConnectError = true;
        console.warn('[VibeSocket] Connection error (will keep retrying):', err.message);
      }
    });
    socket.on('disconnect', (reason) => {
      console.log('[VibeSocket] Disconnected:', reason);
    });
  }
  return socket;
}

/** Emit only after the connection is ready (connect fires async). */
export function emitWhenConnected(socket: Socket, event: string, data: unknown) {
  if (socket.connected) {
    socket.emit(event, data);
  } else {
    socket.once('connect', () => socket.emit(event, data));
  }
}

/** Close the shared socket — call only when the vibe flow is finished. */
export function closeVibeSocket() {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}
