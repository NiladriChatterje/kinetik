import { Queue, Worker, Job } from 'bullmq';
import { Redis } from 'ioredis';
import { Pool } from 'pg';
import { Producer } from 'kafkajs';
import { REDIS_KEYS, KAFKA_TOPICS, MATCH_QUEUE_BATCH_SIZE, H3_SEARCH_RING_RADIUS } from '@kinetik/shared';
import { VectorMatcher } from '../matchers/vectorMatcher';
import { SpatialMatcher } from '../matchers/spatialMatcher';
import { WindowManager } from '../services/windowManager';

interface WorkerDependencies {
  pool: Pool;
  vectorMatcher: VectorMatcher;
  spatialMatcher: SpatialMatcher;
  windowManager: WindowManager;
  kafkaProducer: Producer;
}

interface MatchJobData {
  type: 'find_match' | 'batch_process';
  userId: string;
  windowId: string;
  h3Index?: string;
}

export class MatchWorker {
  private queue: Queue;
  private worker: Worker;
  private activeCount: number = 0;

  constructor(
    queueName: string,
    private redis: Redis,
    private deps: WorkerDependencies,
  ) {
    this.queue = new Queue(queueName, {
      connection: redis,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    });

    this.worker = new Worker<MatchJobData>(
      queueName,
      async (job: Job<MatchJobData>) => {
        this.activeCount++;
        try {
          await this.processJob(job);
        } finally {
          this.activeCount--;
        }
      },
      {
        connection: redis,
        concurrency: 10,
        limiter: { max: 50, duration: 1000 },
      },
    );

    this.worker.on('completed', (job: Job) => {
      console.log(`[MatchWorker] Job ${job.id} completed: ${job.data.type}`);
    });

    this.worker.on('failed', (job: Job | undefined, err: Error) => {
      console.error(`[MatchWorker] Job ${job?.id} failed:`, err.message);
    });
  }

  async start() {
    await this.queue.waitUntilReady();
    console.log('[MatchWorker] Queue worker started');
  }

  async stop() {
    await this.worker.close();
    await this.queue.close();
    console.log('[MatchWorker] Queue worker stopped');
  }

  getActiveCount(): number {
    return this.activeCount;
  }

  // ─── Queue Jobs ─────────────────────────────────────

  async checkForMatch(userId: string, windowId: string) {
    await this.queue.add('find_match', {
      type: 'find_match',
      userId,
      windowId,
    });
  }

  async scheduleBatchProcess(windowId: string, h3Index: string) {
    await this.queue.add('batch_process', {
      type: 'batch_process',
      userId: '',
      windowId,
      h3Index,
    });
  }

  // ─── Job Processing ─────────────────────────────────

  private async processJob(job: Job<MatchJobData>) {
    const { type, userId, windowId, h3Index } = job.data;

    switch (type) {
      case 'find_match':
        await this.findSingleMatch(userId, windowId);
        break;
      case 'batch_process':
        if (h3Index) {
          await this.processBatch(windowId, h3Index);
        }
        break;
    }
  }

  private async findSingleMatch(userId: string, windowId: string) {
    // Check if user is already in a vibe check
    const inVibe = await this.redis.get(REDIS_KEYS.VIBE_CHECK_USER(userId));
    if (inVibe) return;

    // Check if already being matched
    const inProgress = await this.redis.get(REDIS_KEYS.MATCH_IN_PROGRESS(userId));
    if (inProgress) return;

    // Mark as matching in progress
    await this.redis.set(REDIS_KEYS.MATCH_IN_PROGRESS(userId), '1', 'EX', 30);

    try {
      // Get user's location
      const userData = await this.deps.pool.query(
        'SELECT h3_index, latitude, longitude FROM users WHERE id = $1',
        [userId],
      );
      if (!userData.rows[0]?.h3_index) return;

      const h3Index = userData.rows[0].h3_index;

      // Get nearby active users via spatial matcher
      const nearbyUsers = await this.deps.spatialMatcher.getNearbyUsers(
        h3Index,
        windowId,
        userId,
      );

      if (nearbyUsers.length === 0) return;

      // Get user's vector and preferences
      const userPrefs = await this.deps.pool.query(
        `SELECT uv.vector, up.weight_values, up.weight_age, up.weight_distance,
                up.weight_interests, up.age_min, up.age_max, up.max_distance_km,
                up.values_ambition, up.values_social, up.values_adventure,
                up.values_tradition, up.values_intellect, up.values_emotional
         FROM user_vectors uv
         LEFT JOIN user_preferences up ON up.user_id = $1
         WHERE uv.user_id = $1`,
        [userId],
      );

      if (!userPrefs.rows[0]?.vector) return;

      // Run vector similarity matching
      const bestMatch = await this.deps.vectorMatcher.findBestMatch(
        userPrefs.rows[0],
        nearbyUsers,
      );

      if (!bestMatch) return;

      // Create vibe check session
      const vibeId = await this.createVibeCheck(userId, bestMatch.userId, windowId);

      // Notify both users via Kafka
      await this.deps.kafkaProducer.send({
        topic: KAFKA_TOPICS.MATCH_EVENTS,
        messages: [
          {
            key: 'match.found',
            value: JSON.stringify({
              type: 'match.found',
              payload: {
                vibeId,
                userAId: userId,
                userBId: bestMatch.userId,
                windowId,
                timestamp: new Date().toISOString(),
              },
            }),
          },
        ],
      });

      // Remove matched users from queue
      await this.redis.srem(REDIS_KEYS.MATCH_POOL(windowId), userId, bestMatch.userId);
      await this.redis.set(REDIS_KEYS.VIBE_CHECK_USER(userId), vibeId, 'EX', 300);
      await this.redis.set(REDIS_KEYS.VIBE_CHECK_USER(bestMatch.userId), vibeId, 'EX', 300);
    } finally {
      await this.redis.del(REDIS_KEYS.MATCH_IN_PROGRESS(userId));
    }
  }

  private async processBatch(windowId: string, h3Index: string) {
    // Get all users in this H3 cell
    const users = await this.redis.smembers(REDIS_KEYS.MATCH_POOL(windowId));
    const shuffled = users.sort(() => Math.random() - 0.5);

    // Process in smaller chunks
    const chunks = this.chunkArray(shuffled, MATCH_QUEUE_BATCH_SIZE);
    for (const chunk of chunks) {
      for (const userId of chunk) {
        await this.queue.add('find_match', {
          type: 'find_match',
          userId,
          windowId,
        }, { delay: 100 }); // Stagger matching attempts
      }
    }
  }

  private async createVibeCheck(userAId: string, userBId: string, windowId: string): Promise<string> {
    const { v4: uuidv4 } = require('uuid');
    const vibeId = uuidv4();

    await this.deps.pool.query(
      `INSERT INTO vibe_checks (id, window_id, user_a_id, user_b_id, status, started_at, call_duration_seconds)
       VALUES ($1, $2, $3, $4, 'pending', NOW(), 180)`,
      [vibeId, windowId, userAId, userBId],
    );

    return vibeId;
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}
