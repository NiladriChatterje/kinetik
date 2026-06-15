import Redis from 'ioredis';

let redisClient: Redis | null = null;

export function initializeRedis(): Redis {
  if (!redisClient) {
    redisClient = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      maxRetriesPerRequest: 3,
      enableOfflineQueue: false,
    });

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
