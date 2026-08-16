import http from 'http';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import jwt from 'jsonwebtoken';
import {
  WsEvent,
  EVENT_BUS_CHANNELS,
  WS_NAMESPACES,
} from '@kinetik/shared';
import { PresenceHandler } from './handlers/presence';
import { ChatHandler } from './handlers/chat';

const PORT = parseInt(process.env.PORT || '3002', 10);
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-jwt-key-change-in-production-2024';

// ─── Redis Clients (main — for Socket.IO adapter + presence + caching) ─
// The Socket.IO Redis adapter requires two connections to the same Redis
// instance: one for publishing, one for subscribing. ioredis duplicate()
// creates a separate TCP connection sharing the same config.
const pubClient = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD,
  retryStrategy: (times) => Math.min(times * 50, 2000),
  maxRetriesPerRequest: null,    // Infinite retries — adapter recovers after Redis outage
  enableOfflineQueue: false,     // Fail fast when Redis is down rather than queuing
});

const subClient = pubClient.duplicate();

// ─── Event Bus Redis (separate instance — replaces Kafka consumer) ─
const eventBusClient = new Redis({
  host: process.env.REDIS_EVENTS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_EVENTS_PORT || '6380', 10),
  password: process.env.REDIS_EVENTS_PASSWORD,
  retryStrategy: (times) => Math.min(times * 50, 2000),
  maxRetriesPerRequest: null,    // Critical event bus — keep retrying
  enableOfflineQueue: false,
});

// ioredis emits 'error' on connection failures — without a listener an
// unhandled 'error' event crashes the process (and Docker restarts it in a
// loop). Log instead; retryStrategy keeps reconnecting.
for (const [label, client] of [
  ['main', pubClient],
  ['main-sub', subClient],
  ['event-bus', eventBusClient],
] as const) {
  client.on('error', (err) => {
    console.error(`[Redis:${label}] connection error:`, err.message);
  });
}

// With enableOfflineQueue:false, ioredis REJECTS commands issued before the
// connection is established (including the subscribe() calls the adapter and
// handlers make at startup), which crashed realtime into a Docker restart
// loop. Wait until each client is connected before subscribing to anything.
async function waitForRedisReady(client: Redis, label: string): Promise<void> {
  let warned = false;
  while (client.status !== 'ready') {
    if (!warned) {
      console.warn(`[Redis:${label}] Waiting for connection (status=${client.status})...`);
      warned = true;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (warned) {
    console.log(`[Redis:${label}] connected`);
  }
}

// ─── HTTP Server ──────────────────────────────────────────
const server = http.createServer();

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  transports: ['websocket', 'polling'],
  pingInterval: 25000,
  pingTimeout: 20000,
});

// ─── Socket.IO Redis Adapter (cross-instance communication) ─
// NOTE: io.adapter() is applied in bootstrap() AFTER the Redis clients are
// connected — the adapter constructor subscribes the subClient immediately,
// which rejects under enableOfflineQueue:false if Redis isn't ready yet.

// ─── Authentication Middleware ────────────────────────────
// IMPORTANT: io.use() only applies to the DEFAULT namespace. Custom
// namespaces (chat, presence) must register the
// middleware via nsp.use() themselves — otherwise every socket connects
// unauthenticated with userId undefined, which silently breaks room
// membership checks and personal-room routing (chat:join is always denied,
// so live chat broadcasts never arrive).
const authMiddleware = async (socket: any, next: (err?: Error) => void) => {
  const token = socket.handshake.auth?.token || socket.handshake.query?.token;

  if (!token) {
    return next(new Error('Authentication required'));
  }

  try {
    const decoded = jwt.verify(token as string, JWT_SECRET) as any;
    (socket as any).userId = decoded.sub;
    (socket as any).userPhone = decoded.phone;
    next();
  } catch (err) {
    return next(new Error('Invalid or expired token'));
  }
};

// ─── Namespaces ──────────────────────────────────────────
const presenceNsp = io.of(WS_NAMESPACES.PRESENCE);
const chatNsp = io.of(WS_NAMESPACES.CHAT);

// Apply auth to the default namespace AND every custom namespace (see note
// above — io.use() alone leaves all custom namespaces unauthenticated).
io.use(authMiddleware);
presenceNsp.use(authMiddleware);
chatNsp.use(authMiddleware);

// ─── Default Namespace (Connection Status) ───────────────
io.on('connection', (socket) => {
  const userId = (socket as any).userId;
  console.log(`[Connection] User ${userId} connected (socket: ${socket.id})`);

  socket.emit(WsEvent.CONNECT, { userId, socketId: socket.id });

  socket.on('disconnect', () => {
    console.log(`[Connection] User ${userId} disconnected`);
  });
});

// ─── Start Event Bus Subscriber (replaces Kafka consumer) ─
async function startEventBusSubscriber() {
  // Subscribe to event bus channels
  await eventBusClient.subscribe(EVENT_BUS_CHANNELS.MATCH_EVENTS);

  eventBusClient.on('message', (channel: string, message: string) => {
    try {
      const event = JSON.parse(message);
      console.log(`[EventBus] Received ${channel}: ${event.type}`);

      switch (channel) {
        case EVENT_BUS_CHANNELS.MATCH_EVENTS:
          // Real-time like delivery via presence namespace
          if (event.type === 'like.created' && event.payload) {
            const { targetId, actorId, actorName, action } = event.payload;
            presenceNsp.to(`user:${targetId}`).emit(WsEvent.LIKES_NEW, {
              likedByUserId: actorId,
              likedByName: actorName,
              action: action || 'like',
              timestamp: event.payload.timestamp || new Date().toISOString(),
            });
            chatNsp.to(`user:${targetId}`).emit(WsEvent.LIKES_NEW, {
              likedByUserId: actorId,
              likedByName: actorName,
              action: action || 'like',
              timestamp: event.payload.timestamp || new Date().toISOString(),
            });
          }

          if (event.type === 'match.created' && event.payload) {
            const {
              userAId, userBId, matchId,
              userAName, userBName,
              userAPhotoUrl, userBPhotoUrl,
              initiatorId,
            } = event.payload;
            const timestamp = event.payload.timestamp || new Date().toISOString();

            const payloadForA = {
              matchId,
              partnerId: userBId,
              partnerName: userBName || 'Someone',
              partnerPhotoUrl: userBPhotoUrl || '',
              initiatorId,
              timestamp,
            };
            const payloadForB = {
              matchId,
              partnerId: userAId,
              partnerName: userAName || 'Someone',
              partnerPhotoUrl: userAPhotoUrl || '',
              initiatorId,
              timestamp,
            };

            presenceNsp.to(`user:${userAId}`).emit(WsEvent.MATCH_NEW, payloadForA);
            presenceNsp.to(`user:${userBId}`).emit(WsEvent.MATCH_NEW, payloadForB);
            chatNsp.to(`user:${userAId}`).emit(WsEvent.MATCH_NEW, payloadForA);
            chatNsp.to(`user:${userBId}`).emit(WsEvent.MATCH_NEW, payloadForB);
          }
          break;
      }
    } catch (err) {
      console.error('[EventBus] Failed to parse message:', err);
    }
  });

  console.log(`📡 Subscribed to event bus channels: ${EVENT_BUS_CHANNELS.MATCH_EVENTS}`);
}

// ─── Start Server ─────────────────────────────────────────
async function bootstrap() {
  try {
    // All subscribe() calls must happen AFTER the Redis connections are
    // established — with enableOfflineQueue:false a command issued while
    // disconnected is rejected, which previously exited the process at
    // startup and put the container in a Docker restart loop.
    await Promise.all([
      waitForRedisReady(pubClient, 'main'),
      waitForRedisReady(subClient, 'main-sub'),
      waitForRedisReady(eventBusClient, 'event-bus'),
    ]);

    io.adapter(createAdapter(pubClient, subClient));

    // Handlers subscribe to Redis channels in their constructors — construct
    // them only after the connections are ready.
    new PresenceHandler(presenceNsp, pubClient, subClient);
    new ChatHandler(chatNsp, pubClient, subClient);

    await startEventBusSubscriber();

    server.listen(PORT, '0.0.0.0', () => {
      console.log(`🔌 Kinetik Real-Time WS running on port ${PORT}`);
      console.log(`📡 Namespaces: ${Object.values(WS_NAMESPACES).join(', ')}`);
    });
  } catch (err) {
    console.error('Failed to start realtime service:', err);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received. Shutting down...');
  await eventBusClient.quit();
  io.close();
  pubClient.quit();
  subClient.quit();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received. Shutting down...');
  await eventBusClient.quit();
  io.close();
  pubClient.quit();
  subClient.quit();
  process.exit(0);
});

bootstrap();

export { io, pubClient, subClient, eventBusClient };
