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
 * Read the access token at the moment a namespace (re)connects, so every
 * reconnection attempt carries the current token without anyone having to
 * refresh it on the socket by hand.
 */
const auth = (cb: (data: object) => void) => cb({ token: api.getToken() });

type RealtimeNamespace = '/chat' | '/presence';

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
  return socket;
}
