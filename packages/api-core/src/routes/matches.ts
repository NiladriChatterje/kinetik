import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ERROR_CODES } from '@kinetik/shared';
import { query, TABLES } from '../services/database';

export async function matchRoutes(app: FastifyInstance) {
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

  // ─── List Matches ────────────────────────────────────
  app.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const { sub: userId } = request.user as any;

    const result = await query(
      `SELECT m.*, 
              u.display_name as partner_name,
              pp.url as partner_photo_url,
              pp.thumbnail_url as partner_thumbnail_url,
              vc.started_at as vibe_started_at,
              vc.call_duration_seconds
       FROM ${TABLES.MATCHES} m
       LEFT JOIN ${TABLES.VIBE_CHECKS} vc ON m.vibe_check_id = vc.id
       JOIN ${TABLES.USERS} u ON u.id = CASE WHEN m.user_a_id = $1 THEN m.user_b_id ELSE m.user_a_id END
       LEFT JOIN ${TABLES.PROFILE_PHOTOS} pp ON pp.user_id = u.id AND pp.is_primary = TRUE
       WHERE (m.user_a_id = $1 OR m.user_b_id = $1) AND m.is_active = TRUE
       ORDER BY m.matched_at DESC
       LIMIT 50`,
      [userId],
    );

    return reply.send({ success: true, data: result.rows });
  });

  // ─── Get Match Detail ────────────────────────────────
  app.get('/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    const { sub: userId } = request.user as any;

    const result = await query(
      `SELECT m.*,
              u.display_name as partner_name,
              u.bio as partner_bio,
              u.date_of_birth as partner_dob,
              u.occupation as partner_occupation,
              pp.url as partner_photo_url,
              vc.created_at as vibe_created_at,
              vc.started_at as vibe_started_at,
              vc.call_duration_seconds,
              v.m_name as venue_name,
              v.address as venue_address,
              v.category as venue_category,
              v.image_url as venue_image_url
       FROM ${TABLES.MATCHES} m
       LEFT JOIN ${TABLES.VIBE_CHECKS} vc ON m.vibe_check_id = vc.id
       LEFT JOIN ${TABLES.RESERVATIONS} r ON r.match_id = m.id
       LEFT JOIN ${TABLES.VENUES} v ON r.venue_id = v.id
       JOIN ${TABLES.USERS} u ON u.id = CASE WHEN m.user_a_id = $1 THEN m.user_b_id ELSE m.user_a_id END
       LEFT JOIN ${TABLES.PROFILE_PHOTOS} pp ON pp.user_id = u.id AND pp.is_primary = TRUE
       WHERE m.id = $1 AND (m.user_a_id = $2 OR m.user_b_id = $2)`,
      [id, userId],
    );

    if (!result.rows[0]) {
      return reply.status(404).send({
        success: false,
        error: { code: ERROR_CODES.NOT_FOUND, message: 'Match not found' },
      });
    }

    return reply.send({ success: true, data: result.rows[0] });
  });
}
