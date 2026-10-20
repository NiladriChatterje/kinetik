import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ERROR_CODES } from '@kinetik/shared';
import { query, TABLES } from '../services/database';

export async function faceVerificationRoutes(app: FastifyInstance) {
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
  // Confirms only that the selfie shows the same person as the photos the
  // user uploaded. There is no liveness or pose challenge. Detection and
  // matching run entirely on the device (mobile: services/faceVerification.ts
  // — ML Kit + MobileFaceNet); the client self-reports the outcome here and
  // the selfie never reaches the server. A UX signal, not a security
  // guarantee — see FACE_VERIFICATION_ONDEVICE.md.
  app.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const { sub: userId } = request.user as any;
    const { verified, confidence, skipped } = (request.body ?? {}) as {
      verified?: boolean;
      confidence?: number;
      skipped?: boolean;
    };

    if (typeof verified !== 'boolean') {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_BODY', message: '`verified` (boolean) is required.' },
      });
    }

    if (skipped === true) {
      // The user skipped the selfie step. Clear any earlier face match too:
      // they may have changed their photos since, and the profile must show
      // Face unverified. is_verified stays TRUE only for a KYC-verified account.
      await query(
        `UPDATE ${TABLES.USERS}
         SET face_verification_status = 'unverified',
             is_verified = COALESCE(kyc_status = 'verified', FALSE)
         WHERE id = $1`,
        [userId],
      );
      console.log(`[face-verification] User ${userId} skipped face verification`);
      return reply.status(201).send({ success: true, data: { status: 'unverified' } });
    }

    if (verified) {
      await query(
        `UPDATE ${TABLES.USERS} SET is_verified = TRUE, face_verification_status = 'verified' WHERE id = $1`,
        [userId],
      );
      console.log(
        `[face-verification] User ${userId} verified on-device (confidence=${confidence ?? 'n/a'})`,
      );
    } else {
      // The latest selfie did not match — at onboarding, or when the user
      // chose to make a photo primary without a matching selfie. Drop the
      // face badge so it never vouches for photos the selfie did not match.
      // is_verified stays TRUE only for a separately KYC-verified account.
      await query(
        `UPDATE ${TABLES.USERS}
         SET face_verification_status = 'rejected',
             is_verified = COALESCE(kyc_status = 'verified', FALSE)
         WHERE id = $1`,
        [userId],
      );
      console.log(
        `[face-verification] On-device verification not confirmed for user ${userId} (confidence=${confidence ?? 'n/a'})`,
      );
    }

    return reply.status(201).send({
      success: true,
      data: { status: verified ? 'verified' : 'rejected' },
    });
  });
}
