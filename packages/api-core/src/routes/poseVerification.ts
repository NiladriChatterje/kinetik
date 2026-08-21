import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ERROR_CODES } from '@kinetik/shared';
import { query, TABLES } from '../services/database';

export async function poseVerificationRoutes(app: FastifyInstance) {
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

  // ─── Report On-Device Face Verification Result ──────────
  // Face detection and selfie ↔ profile-photo matching run entirely on the
  // device (mobile: services/faceVerification.ts — ML Kit + MobileFaceNet).
  // The client self-reports the outcome here; the selfie never reaches the
  // server. This is a UX signal, not a security guarantee — see
  // POSE_VERIFICATION_ONDEVICE.md.
  app.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const { sub: userId } = request.user as any;
    const { verified, confidence } = (request.body ?? {}) as {
      verified?: boolean;
      confidence?: number;
    };

    if (typeof verified !== 'boolean') {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_BODY', message: '`verified` (boolean) is required.' },
      });
    }

    if (verified) {
      await query(
        `UPDATE ${TABLES.USERS} SET is_verified = TRUE, liveness_status = 'verified' WHERE id = $1`,
        [userId],
      );
      console.log(
        `[pose-verification] User ${userId} verified on-device (confidence=${confidence ?? 'n/a'})`,
      );
    } else {
      // Not verified — leave status untouched; user proceeds with onboarding
      console.log(
        `[pose-verification] On-device verification not confirmed for user ${userId} (confidence=${confidence ?? 'n/a'})`,
      );
    }

    return reply.status(201).send({
      success: true,
      data: { status: verified ? 'verified' : 'pending' },
    });
  });
}
