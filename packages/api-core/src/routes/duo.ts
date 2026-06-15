import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ERROR_CODES, generateInviteCode } from '@kinetik/shared';
import { query, TABLES } from '../services/database';
import { kafkaProducer } from '../services/kafka';

export async function duoRoutes(app: FastifyInstance) {
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

  // ─── Create Duo Crew ─────────────────────────────────
  app.post('/create', async (request: FastifyRequest, reply: FastifyReply) => {
    const { sub: userId } = request.user as any;

    // Generate unique invite code
    let inviteCode = generateInviteCode();
    let exists = true;
    while (exists) {
      const check = await query(
        `SELECT id FROM ${TABLES.DUO_CREWS} WHERE invite_code = $1`,
        [inviteCode],
      );
      if (check.rows.length === 0) {
        exists = false;
      } else {
        inviteCode = generateInviteCode();
      }
    }

    const result = await query(
      `INSERT INTO ${TABLES.DUO_CREWS} (creator_id, invite_code) VALUES ($1, $2) RETURNING *`,
      [userId, inviteCode],
    );

    await kafkaProducer.sendUserEvent({
      type: 'duo.crew_created',
      payload: { userId, inviteCode },
    });

    return reply.status(201).send({ success: true, data: result.rows[0] });
  });

  // ─── Join Duo Crew by Invite Code ────────────────────
  app.post('/join/:code', async (request: FastifyRequest<{ Params: { code: string } }>, reply: FastifyReply) => {
    const { code } = request.params;
    const { sub: userId } = request.user as any;

    // Normalize code (remove dashes)
    const normalizedCode = code.replace(/-/g, '');

    const crewResult = await query(
      `SELECT * FROM ${TABLES.DUO_CREWS} WHERE invite_code = $1 AND is_active = TRUE AND invite_accepted = FALSE`,
      [normalizedCode],
    );

    if (!crewResult.rows[0]) {
      return reply.status(404).send({
        success: false,
        error: { code: ERROR_CODES.NOT_FOUND, message: 'Invalid or expired invite code' },
      });
    }

    const crew = crewResult.rows[0];

    // Cannot join your own crew
    if (crew.creator_id === userId) {
      return reply.status(400).send({
        success: false,
        error: { code: ERROR_CODES.FORBIDDEN, message: 'Cannot join your own crew' },
      });
    }

    await query(
      `UPDATE ${TABLES.DUO_CREWS} SET invitee_id = $1, invite_accepted = TRUE WHERE id = $2`,
      [userId, crew.id],
    );

    await kafkaProducer.sendUserEvent({
      type: 'duo.crew_joined',
      payload: { crewId: crew.id, creatorId: crew.creator_id, inviteeId: userId },
    });

    return reply.send({ success: true, data: { ...crew, inviteeId: userId, inviteAccepted: true } });
  });
}
