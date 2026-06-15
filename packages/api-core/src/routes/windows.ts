import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ERROR_CODES, REDIS_KEYS } from '@kinetik/shared';
import { query, TABLES } from '../services/database';
import { getRedis } from '../services/redis';
import { kafkaProducer } from '../services/kafka';

export async function windowRoutes(app: FastifyInstance) {
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

  // ─── Get Active Windows ──────────────────────────────
  app.get('/active', async (request: FastifyRequest, reply: FastifyReply) => {
    const { sub: userId } = request.user as any;

    // Get windows that are currently active or starting soon
    const result = await query(
      `SELECT fw.*, 
              (SELECT COUNT(*) FROM ${TABLES.WINDOW_PARTICIPANTS} wp WHERE wp.window_id = fw.id AND wp.is_active = TRUE) as current_participants
       FROM ${TABLES.FLASH_WINDOWS} fw
       WHERE fw.status IN ('scheduled', 'active')
         AND fw.starts_at <= NOW() + INTERVAL '1 hour'
         AND fw.ends_at >= NOW()
       ORDER BY fw.starts_at ASC
       LIMIT 10`,
    );

    return reply.send({ success: true, data: result.rows });
  });

  // ─── Get Window Details ──────────────────────────────
  app.get('/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    const { sub: userId } = request.user as any;

    const result = await query(
      `SELECT fw.*,
              (SELECT COUNT(*) FROM ${TABLES.WINDOW_PARTICIPANTS} wp WHERE wp.window_id = fw.id AND wp.is_active = TRUE) as current_participants
       FROM ${TABLES.FLASH_WINDOWS} fw
       WHERE fw.id = $1`,
      [id],
    );

    if (!result.rows[0]) {
      return reply.status(404).send({
        success: false,
        error: { code: ERROR_CODES.NOT_FOUND, message: 'Window not found' },
      });
    }

    // Check if user is a participant
    const participant = await query(
      `SELECT * FROM ${TABLES.WINDOW_PARTICIPANTS} WHERE window_id = $1 AND user_id = $2`,
      [id, userId],
    );

    return reply.send({
      success: true,
      data: {
        ...result.rows[0],
        isParticipant: participant.rows.length > 0,
        participantStatus: participant.rows[0]?.is_active ? 'active' : 'inactive',
      },
    });
  });

  // ─── Join Window ─────────────────────────────────────
  app.post('/:id/join', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    const { sub: userId } = request.user as any;

    // Check window exists and is active
    const windowResult = await query(
      `SELECT * FROM ${TABLES.FLASH_WINDOWS} WHERE id = $1 AND status IN ('scheduled', 'active')`,
      [id],
    );

    if (!windowResult.rows[0]) {
      return reply.status(404).send({
        success: false,
        error: { code: ERROR_CODES.NOT_FOUND, message: 'Window not available' },
      });
    }

    const window = windowResult.rows[0];

    // Check capacity
    if (window.participant_count >= window.max_participants) {
      return reply.status(400).send({
        success: false,
        error: { code: ERROR_CODES.NOT_IN_WINDOW, message: 'Window is full' },
      });
    }

    // Check if already joined
    const existing = await query(
      `SELECT * FROM ${TABLES.WINDOW_PARTICIPANTS} WHERE window_id = $1 AND user_id = $2`,
      [id, userId],
    );

    if (existing.rows.length > 0) {
      // Reactivate if inactive
      if (!existing.rows[0].is_active) {
        await query(
          `UPDATE ${TABLES.WINDOW_PARTICIPANTS} SET is_active = TRUE, joined_at = NOW() WHERE window_id = $1 AND user_id = $2`,
          [id, userId],
        );
      }
      return reply.send({ success: true, data: { alreadyJoined: true } });
    }

    // Join window
    await query(
      `INSERT INTO ${TABLES.WINDOW_PARTICIPANTS} (window_id, user_id) VALUES ($1, $2)`,
      [id, userId],
    );

    // Increment participant count
    await query(
      `UPDATE ${TABLES.FLASH_WINDOWS} SET participant_count = participant_count + 1 WHERE id = $1`,
      [id],
    );

    // Add to Redis H3 queue for matching
    const redis = getRedis();
    const userResult = await query(`SELECT h3_index FROM ${TABLES.USERS} WHERE id = $1`, [userId]);
    if (userResult.rows[0]?.h3_index) {
      await redis.sadd(REDIS_KEYS.H3_QUEUE(userResult.rows[0].h3_index), userId);
    }

    // Emit event
    await kafkaProducer.sendMatchEvent({
      type: 'window.joined',
      payload: { windowId: id, userId, timestamp: new Date().toISOString() },
    });

    return reply.status(200).send({ success: true, data: { joined: true } });
  });

  // ─── Leave Window ────────────────────────────────────
  app.post('/:id/leave', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    const { sub: userId } = request.user as any;

    await query(
      `UPDATE ${TABLES.WINDOW_PARTICIPANTS} SET is_active = FALSE WHERE window_id = $1 AND user_id = $2`,
      [id, userId],
    );

    await query(
      `UPDATE ${TABLES.FLASH_WINDOWS} SET participant_count = GREATEST(participant_count - 1, 0) WHERE id = $1`,
      [id],
    );

    // Remove from Redis H3 queue
    const userResult = await query(`SELECT h3_index FROM ${TABLES.USERS} WHERE id = $1`, [userId]);
    if (userResult.rows[0]?.h3_index) {
      const redis = getRedis();
      await redis.srem(REDIS_KEYS.H3_QUEUE(userResult.rows[0].h3_index), userId);
    }

    await kafkaProducer.sendMatchEvent({
      type: 'window.left',
      payload: { windowId: id, userId },
    });

    return reply.send({ success: true, data: { left: true } });
  });
}
