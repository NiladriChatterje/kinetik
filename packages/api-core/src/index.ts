import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';

import multipart from '@fastify/multipart';
import { API_ROUTES, ERROR_CODES } from '@kinetik/shared';
import Redis from 'ioredis';
import { authRoutes } from './routes/auth';
import { userRoutes } from './routes/users';
import { onboardingRoutes } from './routes/onboarding';
import { matchRoutes } from './routes/matches';
import { paymentRoutes } from './routes/payments';
import { venueRoutes } from './routes/venues';
import { fanRoutes } from './routes/fans';
import { duoRoutes } from './routes/duo';
import { webhookRoutes } from './routes/webhooks';
import { notificationRoutes } from './routes/notifications';
import { photoRoutes } from './routes/photos';
import { faceVerificationRoutes } from './routes/faceVerification';
import { kycRoutes } from './routes/kyc';
import { locationRoutes } from './routes/locations';
import { errorHandler } from './middleware/errorHandler';
import { eventBus } from './services/eventBus';
import { initializeRedis } from './services/redis';

const PORT = parseInt(process.env.PORT || '3001', 10);
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-jwt-key-change-in-production-2024';

async function bootstrap() {
  const app = Fastify({
    logger: {
      level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    },
    // All traffic arrives via the nginx container on the private Docker
    // network, which sets X-Forwarded-For. Without this, request.ip is
    // nginx's address for every caller and the rate limiter below becomes
    // one bucket shared by all users. Only private-range peers are trusted,
    // so a forged header on a direct public connection is ignored.
    trustProxy: 'loopback, uniquelocal',
  });

  // ─── Plugins ──────────────────────────────────────────
  await app.register(cors, {
    origin: true,
    credentials: true,
  });

  await app.register(jwt, {
    secret: JWT_SECRET,
    sign: { expiresIn: process.env.JWT_EXPIRES_IN || '15m' },
  });

  // ─── Multipart Upload Support ───────────────────────────
  await app.register(multipart, {
    limits: {
      fieldSize: 10 * 1024 * 1024, // 10 MB max file size
      fileSize: 10 * 1024 * 1024,
      files: 1,
    },
  });

  // ─── Note: Static files (photos) are served by MinIO via nginx ─
  // Photo uploads are stored in MinIO (S3-compatible) and proxied
  // through nginx at /uploads/. See nginx.conf for the proxy config.

  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    redis: new Redis(process.env.REDIS_AIVEN_URL!, {
      tls: { servername: process.env.REDIS_AIVEN_HOST! },
      enableOfflineQueue: false,
    }),
    // Logged-in requests get a per-user bucket: carrier NAT puts many users
    // behind one IP. Anonymous or expired-token requests stay keyed by IP.
    keyGenerator: (request) => {
      const auth = request.headers.authorization;
      if (auth?.startsWith('Bearer ')) {
        try {
          return `user:${app.jwt.verify<{ sub: string }>(auth.slice(7)).sub}`;
        } catch {}
      }
      return request.ip;
    },
  });

  // ─── Decorate with Redis & Event Bus ─────────────────
  const redis = initializeRedis();
  const eb = eventBus;

  app.decorate('redis', redis);
  app.decorate('eventBus', eb);

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
  await app.register(matchRoutes, { prefix: API_ROUTES.MATCHES_PREFIX });
  await app.register(fanRoutes, { prefix: '/api/v1/fans' });
  await app.register(venueRoutes, { prefix: API_ROUTES.VENUES_PREFIX });
  await app.register(paymentRoutes, { prefix: API_ROUTES.PAYMENTS_PREFIX });
  await app.register(duoRoutes, { prefix: API_ROUTES.DUO_PREFIX });
  await app.register(webhookRoutes, { prefix: '/api/v1/webhooks' });
  await app.register(notificationRoutes, { prefix: API_ROUTES.NOTIFICATIONS_PREFIX });
  await app.register(photoRoutes, { prefix: '/api/v1/users/photos' });
  await app.register(faceVerificationRoutes, { prefix: '/api/v1/users/face-verification' });
  await app.register(kycRoutes, { prefix: '/api/v1/kyc' });
  await app.register(locationRoutes, { prefix: '/api/v1/locations' });

  // ─── Start ───────────────────────────────────────────
  try {
    await app.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`🚀 Kinetik Core API running on port ${PORT}`);
    console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);

    // Graceful shutdown — must be inside bootstrap() so eventBus/redis are in scope
    const shutdown = async (signal: string) => {
      console.log(`${signal} received. Shutting down gracefully...`);
      await eb.disconnect();
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
