import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { ERROR_CODES, TABLES } from '@kinetik/shared';
import { query } from '../services/database';
import { registerPushToken, unregisterPushToken } from '../services/notificationService';

const RegisterTokenSchema = z.object({
  token: z.string().min(1),
  platform: z.enum(['ios', 'android', 'web']),
});

const UpdateNotificationPrefsSchema = z.object({
  pushEnabled: z.boolean().optional(),
  flashWindowReminder: z.boolean().optional(),
});

export async function notificationRoutes(app: FastifyInstance) {
  // All routes require authentication
  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      reply.status(401).send({
        success: false,
        error: { code: ERROR_CODES.UNAUTHORIZED, message: 'Authentication required' },
      });
    }
  });

  // ─── Register Push Token ─────────────────────────────
  app.post('/register-token', async (request: FastifyRequest, reply: FastifyReply) => {
    const { sub: userId } = request.user as any;

    const validation = RegisterTokenSchema.safeParse(request.body);
    if (!validation.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'Invalid token data',
          details: validation.error.flatten(),
        },
      });
    }

    const { token, platform } = validation.data;
    await registerPushToken(userId, token, platform);

    return reply.send({ success: true, data: { message: 'Push token registered' } });
  });

  // ─── Unregister Push Token ───────────────────────────
  app.post('/unregister-token', async (request: FastifyRequest, reply: FastifyReply) => {
    const { sub: userId } = request.user as any;
    const schema = z.object({ token: z.string().min(1) });
    const validation = schema.safeParse(request.body);

    if (!validation.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'Invalid token',
          details: validation.error.flatten(),
        },
      });
    }

    await unregisterPushToken(userId, validation.data.token);
    return reply.send({ success: true, data: { message: 'Push token unregistered' } });
  });

  // ─── Get Notification Preferences ────────────────────
  app.get('/preferences', async (request: FastifyRequest, reply: FastifyReply) => {
    const { sub: userId } = request.user as any;

    const result = await query(
      `SELECT push_enabled, flash_window_reminder FROM ${TABLES.USER_PREFERENCES} WHERE user_id = $1`,
      [userId],
    );

    const prefs = result.rows[0];

    return reply.send({
      success: true,
      data: {
        pushEnabled: prefs?.push_enabled ?? true,
        flashWindowReminder: prefs?.flash_window_reminder ?? true,
      },
    });
  });

  // ─── Update Notification Preferences ─────────────────
  app.put('/preferences', async (request: FastifyRequest, reply: FastifyReply) => {
    const { sub: userId } = request.user as any;

    const validation = UpdateNotificationPrefsSchema.safeParse(request.body);
    if (!validation.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'Invalid preferences',
          details: validation.error.flatten(),
        },
      });
    }

    const data = validation.data;
    const updateFields: string[] = [];
    const updateValues: any[] = [];
    let paramIndex = 2;

    if (data.pushEnabled !== undefined) {
      updateFields.push(`push_enabled = $${paramIndex++}`);
      updateValues.push(data.pushEnabled);
    }
    if (data.flashWindowReminder !== undefined) {
      updateFields.push(`flash_window_reminder = $${paramIndex++}`);
      updateValues.push(data.flashWindowReminder);
    }

    if (updateFields.length === 0) {
      return reply.status(400).send({
        success: false,
        error: { code: ERROR_CODES.VALIDATION_ERROR, message: 'No valid fields to update' },
      });
    }

    await query(
      `INSERT INTO ${TABLES.USER_PREFERENCES} (user_id, ${updateFields.map((f) => f.split(' = ')[0]).join(', ')})
       VALUES ($1, ${updateValues.map((_, i) => `$${i + 2}`).join(', ')})
       ON CONFLICT (user_id) DO UPDATE SET ${updateFields.join(', ')}, updated_at = NOW()`,
      [userId, ...updateValues],
    );

    return reply.send({ success: true, data: { message: 'Notification preferences updated' } });
  });
}
