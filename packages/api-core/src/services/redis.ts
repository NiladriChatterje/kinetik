import Redis from 'ioredis';

let redisClient: Redis | null = null;

export function initializeRedis(): Redis {
  if (!redisClient) {
    redisClient = new Redis(
      "rediss://default:i9mBSZ62xWSnOG8RPxq2cFrU@redis-events-tiny-coast.cloud.layerbase.dev:6379",
      {
        tls: { servername: 'redis-events-tiny-coast.cloud.layerbase.dev' }
        //   host: process.env.REDIS_HOST || 'localhost',
        //   port: parseInt(process.env.REDIS_PORT || '6379', 10),
        //   password: process.env.REDIS_PASSWORD,
        //   retryStrategy: (times) => {
        //     const delay = Math.min(times * 50, 2000);
        //     return delay;
        //   },
        //   maxRetriesPerRequest: 3,
        //   enableOfflineQueue: false,
      }
    );

    redisClient.on('connect', () => {
      console.log('📡 Redis connected');
    });

    redisClient.on('error', (err) => {
      console.error('Redis connection error:', err.message);
    });
  }
  return redisClient;
}

export function getRedis(): Redis {
  if (!redisClient) {
    return initializeRedis();
  }
  return redisClient;
}

/**
 * Publish a payload to a Redis channel with retry/backoff.
 *
 * This client runs with `enableOfflineQueue: false` (fail fast), so any
 * command issued while the connection is reconnecting rejects immediately
 * and the payload would be silently dropped. Chat message broadcasts are
 * delivery-critical (a message persisted in Postgres but never pushed live
 * only shows up after the receiver re-enters the DM), so retry briefly with
 * backoff — aligned with ioredis's retryStrategy (50ms → 2s) — to ride out
 * a transient Redis blip. The message is already durable in Postgres, so
 * worst case it degrades to the existing "visible on next fetch" behavior.
 */
export async function publishChatMessage(channel: string, payload: unknown, attempts = 5): Promise<void> {
  const redis = getRedis();
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await redis.publish(channel, JSON.stringify(payload));
      return;
    } catch (err: any) {
      if (attempt === attempts) {
        console.error(
          `[Redis] Failed to publish to ${channel} after ${attempts} attempts:`, err?.message,
        );
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }
}
