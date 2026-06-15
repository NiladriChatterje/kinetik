import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ERROR_CODES } from '@kinetik/shared';
import { query, TABLES } from '../services/database';

export async function venueRoutes(app: FastifyInstance) {
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

  // ─── Get Nearby Venues ───────────────────────────────
  app.get('/nearby', async (request: FastifyRequest, reply: FastifyReply) => {
    const { sub: userId } = request.user as any;
    const { latitude, longitude, radius } = request.query as any;

    const lat = parseFloat(latitude) || 0;
    const lng = parseFloat(longitude) || 0;
    const rad = parseInt(radius) || 5; // km

    // Simple bounding box query (in production, use PostGIS)
    const result = await query(
      `SELECT id, name, category, description, latitude, longitude,
              address, city, price_tier, image_url,
              (6371 * acos(cos(radians($1)) * cos(radians(latitude)) * 
               cos(radians(longitude) - radians($2)) + 
               sin(radians($1)) * sin(radians(latitude)))) AS distance_km
       FROM ${TABLES.VENUES}
       WHERE is_active = TRUE
         AND (6371 * acos(cos(radians($1)) * cos(radians(latitude)) * 
              cos(radians(longitude) - radians($2)) + 
              sin(radians($1)) * sin(radians(latitude)))) <= $3
       ORDER BY distance_km ASC
       LIMIT 20`,
      [lat, lng, rad],
    );

    return reply.send({ success: true, data: result.rows });
  });

  // ─── Get Venue Detail ────────────────────────────────
  app.get('/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    const result = await query(
      `SELECT * FROM ${TABLES.VENUES} WHERE id = $1 AND is_active = TRUE`,
      [id],
    );

    if (!result.rows[0]) {
      return reply.status(404).send({
        success: false,
        error: { code: ERROR_CODES.NOT_FOUND, message: 'Venue not found' },
      });
    }

    return reply.send({ success: true, data: result.rows[0] });
  });
}
