import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { ERROR_CODES } from '@kinetik/shared';
import { listCountries, searchCities } from '../services/locations';

const CitiesQuerySchema = z.object({
  country: z.string().trim().length(2),
  q: z.string().trim().max(100).optional().default(''),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});

/**
 * Public lookups behind the country → city pickers. No auth: signup needs
 * them before an account exists. Served from the in-process dataset.
 */
export async function locationRoutes(app: FastifyInstance) {
  app.get('/countries', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({ success: true, data: listCountries() });
  });

  app.get('/cities', async (request: FastifyRequest, reply: FastifyReply) => {
    const validation = CitiesQuerySchema.safeParse(request.query);
    if (!validation.success) {
      return reply.status(400).send({
        success: false,
        error: { code: ERROR_CODES.VALIDATION_ERROR, message: 'country (2-letter code) is required' },
      });
    }
    const { country, q, limit } = validation.data;
    return reply.send({ success: true, data: searchCities(country, q, limit) });
  });
}
