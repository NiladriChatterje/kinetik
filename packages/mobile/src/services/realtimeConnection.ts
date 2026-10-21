import { AppState } from 'react-native';
import { Manager, Socket } from 'socket.io-client';
import { WS_URL } from '../config';
import { api } from './api';

/**
 * The one WebSocket this device holds to the realtime server.
 *
 * `/chat` and `/presence` are Socket.IO namespaces: logical channels that
 * share a single underlying connection. Each namespace still authenticates
 * on its own, has its own socket id on the server, and reconnects with the
 * others when the connection drops — nothing about the events changes.
 *
 * Previously each namespace was opened with `forceNew: true`, which gave
 * every device two connections, two reconnect cycles and two ping timers.
 */
let manager: Manager | null = null;

/**
 * Hand every namespace (re)connection a token with at least two minutes
 * left: getFreshToken renews it first when it is about to run out, so a
 * reconnect after a long time in the background never carries an expired
 * token.
 */
const auth = (cb: (data: object) => void) => {
  api.getFreshToken().then(
    (token) => cb({ token }),
    () => cb({ token: api.getToken() }),
  );
};

type RealtimeNamespace = '/chat' | '/presence';

/**
 * A handshake the server refuses (an expired or unknown token) makes
 * Socket.IO close that namespace for good instead of retrying. The token is
 * renewed and the namespace reconnected after each of these delays; a
 * refusal that outlasts them is not about the token's age, so it waits for
 * the next return to the foreground instead of looping.
 */
const REFUSED_RETRY_DELAYS_MS = [0, 5000, 30000];

const sockets = new Map<RealtimeNamespace, Socket>();
const refusals = new Map<Socket, number>();
const recovery = new Map<Socket, { onRefused: (err: Error) => void; onConnect: () => void }>();

/** Not closed by sign-out, whose closeChatSocket / closePresenceSocket remove every listener. */
function isInUse(socket: Socket): boolean {
  const handlers = recovery.get(socket);
  return !!handlers && socket.listeners('connect_error').includes(handlers.onRefused);
}

function attachRecovery(socket: Socket) {
  let handlers = recovery.get(socket);
  if (!handlers) {
    handlers = {
      onRefused: () => {
        // A transport failure leaves the socket active while the manager
        // retries on its own; only a refused handshake leaves it inactive
        if (socket.active) return;
        const attempt = refusals.get(socket) ?? 0;
        if (attempt >= REFUSED_RETRY_DELAYS_MS.length) return;
        refusals.set(socket, attempt + 1);
        setTimeout(async () => {
          if (socket.active || !isInUse(socket)) return;
          if (await api.renewToken()) socket.connect();
        }, REFUSED_RETRY_DELAYS_MS[attempt]);
      },
      onConnect: () => {
        refusals.delete(socket);
      },
    };
    recovery.set(socket, handlers);
  }
  // Again after a sign-out removed them, when the next session reuses the socket
  if (!isInUse(socket)) {
    socket.on('connect_error', handlers.onRefused);
    socket.on('connect', handlers.onConnect);
  }
}

// Back in the foreground: renew a token that ran out meanwhile, then
// reconnect any namespace the server refused while the app was away
AppState.addEventListener('change', (state) => {
  if (state !== 'active' || !api.getRefreshToken()) return;
  api.getFreshToken().then((token) => {
    if (!token) return;
    for (const socket of sockets.values()) {
      if (socket.active || !isInUse(socket)) continue;
      refusals.delete(socket);
      socket.connect();
    }
  }, () => {});
});

/**
 * The socket for a namespace on the shared connection. Socket.IO keeps one
 * socket object per namespace: the same object comes back on every call,
 * and a socket that was closed (manually, or by a rejected token) is
 * reconnected here.
 */
export function getNamespaceSocket(nsp: RealtimeNamespace): Socket {
  if (!manager) {
    manager = new Manager(WS_URL, { transports: ['websocket'] });
  }
  const socket = manager.socket(nsp, { auth });
  // `opts` only applies when the socket is first created
  socket.auth = auth;
  sockets.set(nsp, socket);
  attachRecovery(socket);
  return socket;
}
