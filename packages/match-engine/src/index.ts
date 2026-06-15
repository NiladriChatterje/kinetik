import Redis from 'ioredis';
import { Kafka } from 'kafkajs';
import { Pool } from 'pg';
import { KAFKA_TOPICS, VECTOR_SIMILARITY_TOP_K, MATCH_QUEUE_BATCH_SIZE, H3_SEARCH_RING_RADIUS } from '@kinetik/shared';
import { MatchWorker } from './workers/matchWorker';
import { VectorMatcher } from './matchers/vectorMatcher';
import { SpatialMatcher } from './matchers/spatialMatcher';
import { WindowManager } from './services/windowManager';

const PORT = parseInt(process.env.PORT || '3003', 10);
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);
const REDIS_PASSWORD = process.env.REDIS_PASSWORD;
const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');

// ─── Redis ────────────────────────────────────────────────
const redis = new Redis({
  host: REDIS_HOST,
  port: REDIS_PORT,
  password: REDIS_PASSWORD,
  retryStrategy: (times) => Math.min(times * 50, 2000),
  maxRetriesPerRequest: null, // BullMQ requires this
});

// ─── PostgreSQL ───────────────────────────────────────────
const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
});

// ─── Kafka ────────────────────────────────────────────────
const kafka = new Kafka({
  clientId: 'kinetik-match-engine',
  brokers: KAFKA_BROKERS,
});

const kafkaConsumer = kafka.consumer({ groupId: 'match-engine' });
const kafkaProducer = kafka.producer();

// ─── Services ─────────────────────────────────────────────
const windowManager = new WindowManager(redis, pgPool);
const vectorMatcher = new VectorMatcher();
const spatialMatcher = new SpatialMatcher(redis, pgPool);

// ─── Workers ──────────────────────────────────────────────
const matchWorker = new MatchWorker(
  'kinetik-match-queue',
  redis,
  {
    pool: pgPool,
    vectorMatcher,
    spatialMatcher,
    windowManager,
    kafkaProducer,
  },
);

// ─── Kafka Consumer ───────────────────────────────────────
async function startConsumers() {
  await kafkaConsumer.connect();
  await kafkaProducer.connect();

  await kafkaConsumer.subscribe({
    topics: [
      KAFKA_TOPICS.WINDOW_EVENTS,
      KAFKA_TOPICS.MATCH_EVENTS,
      KAFKA_TOPICS.USER_EVENTS,
    ],
    fromBeginning: false,
  });

  await kafkaConsumer.run({
    eachMessage: async ({ topic, message }) => {
      const event = JSON.parse(message.value!.toString());
      console.log(`[MatchEngine] Event: ${topic} - ${event.type}`);

      try {
        switch (topic) {
          case KAFKA_TOPICS.WINDOW_EVENTS:
            if (event.type === 'window.activated') {
              await windowManager.activateWindow(event.payload.windowId);
            } else if (event.type === 'window.closed') {
              await windowManager.closeWindow(event.payload.windowId);
            }
            break;

          case KAFKA_TOPICS.MATCH_EVENTS:
            if (event.type === 'window.joined') {
              // Trigger match check for this user
              await matchWorker.checkForMatch(event.payload.userId, event.payload.windowId);
            }
            break;

          case KAFKA_TOPICS.USER_EVENTS:
            if (event.type === 'preferences.updated' || event.type === 'location.updated') {
              // Invalidate cached match state for this user
              await redis.del(`match:state:${event.payload.userId}`);
            }
            break;
        }
      } catch (err) {
        console.error(`[MatchEngine] Error processing event:`, err);
      }
    },
  });
}

// ─── Health HTTP Server ───────────────────────────────────
const http = require('http');
const healthServer = http.createServer((req: any, res: any) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'match-engine',
      activeWorkers: matchWorker.getActiveCount(),
      activeWindows: windowManager.getActiveWindowCount(),
      timestamp: new Date().toISOString(),
    }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

// ─── Bootstrap ────────────────────────────────────────────
async function bootstrap() {
  try {
    await startConsumers();
    await matchWorker.start();

    healthServer.listen(PORT, '0.0.0.0', () => {
      console.log(`🧠 Kinetik Match Engine running on port ${PORT}`);
      console.log(`⚡ Workers active, consuming match queue`);
    });
  } catch (err) {
    console.error('Failed to start match engine:', err);
    process.exit(1);
  }
}

process.on('SIGTERM', async () => {
  console.log('SIGTERM received. Shutting down...');
  await matchWorker.stop();
  await kafkaConsumer.disconnect();
  await kafkaProducer.disconnect();
  await redis.quit();
  await pgPool.end();
  healthServer.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received. Shutting down...');
  await matchWorker.stop();
  await kafkaConsumer.disconnect();
  await kafkaProducer.disconnect();
  await redis.quit();
  await pgPool.end();
  healthServer.close();
  process.exit(0);
});

bootstrap();
