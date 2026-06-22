import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { API_ROUTES, ERROR_CODES } from '@kinetik/shared';
import Redis from 'ioredis';
import { authRoutes } from './routes/auth';
import { userRoutes } from './routes/users';
import { onboardingRoutes } from './routes/onboarding';
import { windowRoutes } from './routes/windows';
import { matchRoutes } from './routes/matches';
import { paymentRoutes } from './routes/payments';
import { venueRoutes } from './routes/venues';
import { fanRoutes } from './routes/fans';
import { duoRoutes } from './routes/duo';
import { webhookRoutes } from './routes/webhooks';
import { notificationRoutes } from './routes/notifications';
import { errorHandler } from './middleware/errorHandler';
import { kafkaProducer } from './services/kafka';
import { initializeRedis } from './services/redis';
import { initializeDatabase } from './services/database';

const PORT = parseInt(process.env.PORT || '3001', 10);
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-jwt-key-change-in-production-2024';

async function bootstrap() {
  const app = Fastify({
    logger: {
      level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    },
  });

  // ─── Plugins ──────────────────────────────────────────
  await app.register(cors, {
    origin: true,
    credentials: true,
  });

  await app.register(jwt, {
    secret: JWT_SECRET,
    sign: { expiresIn: process.env.JWT_EXPIRES_IN || '7d' },
  });

  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    redis: new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      enableOfflineQueue: false,
    }),
    keyGenerator: (request) => {
      return request.ip;
    },
  });

  // ─── Decorate with Redis & Kafka ──────────────────────
  const redis = initializeRedis();
  const kafka = kafkaProducer;

  app.decorate('redis', redis);
  app.decorate('kafka', kafka);

  // ─── Auth Decorator ───────────────────────────────────
  app.decorate('authenticate', async (request: any, reply: any) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      reply.status(401).send({
        success: false,
        error: { code: ERROR_CODES.UNAUTHORIZED, message: 'Invalid or expired token' },
      });
    }
  });

  // ─── Error Handler ────────────────────────────────────
  app.setErrorHandler(errorHandler);

  // ─── Health Check ─────────────────────────────────────
  app.get('/health', async () => ({
    status: 'ok',
    service: 'api-core',
    timestamp: new Date().toISOString(),
  }));

  // ─── Routes ──────────────────────────────────────────
  await app.register(authRoutes, { prefix: API_ROUTES.AUTH_PREFIX });
  await app.register(userRoutes, { prefix: API_ROUTES.USERS_PREFIX });
  await app.register(onboardingRoutes, { prefix: '/api/v1/onboarding' });
  await app.register(windowRoutes, { prefix: API_ROUTES.WINDOWS_PREFIX });
  await app.register(matchRoutes, { prefix: API_ROUTES.MATCHES_PREFIX });
  await app.register(fanRoutes, { prefix: '/api/v1/fans' });
  await app.register(venueRoutes, { prefix: API_ROUTES.VENUES_PREFIX });
  await app.register(paymentRoutes, { prefix: API_ROUTES.PAYMENTS_PREFIX });
  await app.register(duoRoutes, { prefix: API_ROUTES.DUO_PREFIX });
  await app.register(webhookRoutes, { prefix: '/api/v1/webhooks' });
  await app.register(notificationRoutes, { prefix: API_ROUTES.NOTIFICATIONS_PREFIX });

  // ─── Start ───────────────────────────────────────────
  try {
    await app.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`🚀 Kinetik Core API running on port ${PORT}`);
    console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);

    // Graceful shutdown — must be inside bootstrap() so kafka/redis are in scope
    const shutdown = async (signal: string) => {
      console.log(`${signal} received. Shutting down gracefully...`);
      await kafka.disconnect();
      await redis.quit();
      process.exit(0);
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

bootstrap();
