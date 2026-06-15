import http from 'http';
import { Server } from 'socket.io';
import { Redis } from 'ioredis';
import { Kafka } from 'kafkajs';
import jwt from 'jsonwebtoken';
import {
  WsEvent,
  KAFKA_TOPICS,
  WS_NAMESPACES,
} from '@kinetik/shared';
import { FlashWindowHandler } from './handlers/flashWindow';
import { VibeCheckHandler } from './handlers/vibeCheck';
import { PresenceHandler } from './handlers/presence';

const PORT = parseInt(process.env.PORT || '3002', 10);
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-jwt-key-change-in-production-2024';

// ─── Redis Clients ────────────────────────────────────────
const pubClient = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD,
  retryStrategy: (times) => Math.min(times * 50, 2000),
});

const subClient = pubClient.duplicate();

// ─── Kafka ────────────────────────────────────────────────
const kafka = new Kafka({
  clientId: 'kinetik-realtime',
  brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
});

const kafkaConsumer = kafka.consumer({ groupId: 'realtime-service' });

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

// ─── Authentication Middleware ────────────────────────────
io.use(async (socket, next) => {
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
});

// ─── Namespaces ──────────────────────────────────────────
const flashWindowNsp = io.of(WS_NAMESPACES.FLASH_WINDOW);
const vibeCheckNsp = io.of(WS_NAMESPACES.VIBE_CHECK);
const presenceNsp = io.of(WS_NAMESPACES.PRESENCE);

// ─── Initialize Handlers ─────────────────────────────────
const flashWindowHandler = new FlashWindowHandler(flashWindowNsp, pubClient, subClient);
const vibeCheckHandler = new VibeCheckHandler(vibeCheckNsp, pubClient);
const presenceHandler = new PresenceHandler(presenceNsp, pubClient, subClient);

// ─── Default Namespace (Connection Status) ───────────────
io.on('connection', (socket) => {
  const userId = (socket as any).userId;
  console.log(`[Connection] User ${userId} connected (socket: ${socket.id})`);

  socket.emit(WsEvent.CONNECT, { userId, socketId: socket.id });

  socket.on('disconnect', () => {
    console.log(`[Connection] User ${userId} disconnected`);
  });
});

// ─── Start Kafka Consumer ────────────────────────────────
async function startKafkaConsumer() {
  await kafkaConsumer.connect();
  await kafkaConsumer.subscribe({
    topics: [
      KAFKA_TOPICS.WINDOW_EVENTS,
      KAFKA_TOPICS.MATCH_EVENTS,
      KAFKA_TOPICS.VIBE_EVENTS,
    ],
    fromBeginning: false,
  });

  await kafkaConsumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      const event = JSON.parse(message.value!.toString());
      console.log(`[Kafka] Received ${topic}: ${event.type}`);

      switch (topic) {
        case KAFKA_TOPICS.WINDOW_EVENTS:
          flashWindowNsp.emit('window:event', event);
          break;
        case KAFKA_TOPICS.MATCH_EVENTS:
          flashWindowNsp.emit('match:event', event);
          if (event.type === 'match.found') {
            vibeCheckNsp.to(`user:${event.payload.userAId}`).emit(WsEvent.MATCH_FOUND, event.payload);
            vibeCheckNsp.to(`user:${event.payload.userBId}`).emit(WsEvent.MATCH_FOUND, event.payload);
          }
          break;
        case KAFKA_TOPICS.VIBE_EVENTS:
          vibeCheckNsp.emit('vibe:event', event);
          break;
      }
    },
  });
}

// ─── Start Server ─────────────────────────────────────────
async function bootstrap() {
  try {
    await startKafkaConsumer();

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
  await kafkaConsumer.disconnect();
  io.close();
  pubClient.quit();
  subClient.quit();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received. Shutting down...');
  await kafkaConsumer.disconnect();
  io.close();
  pubClient.quit();
  subClient.quit();
  process.exit(0);
});

bootstrap();

export { io, pubClient, subClient };
