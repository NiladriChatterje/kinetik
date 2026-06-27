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

  // ─── Submit Pose Verification Selfie ────────────────────
  // The selfie is uploaded, compared against existing profile photos for
  // face matching, and then DISCARDED (not saved to MinIO).
  app.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const { sub: userId } = request.user as any;

    // ─── 1. Read the uploaded selfie file ─────────────────
    const file = await request.file();
    if (!file) {
      return reply.status(400).send({
        success: false,
        error: { code: 'NO_FILE', message: 'No photo file provided.' },
      });
    }

    const chunks: Buffer[] = [];
    for await (const chunk of file.file) {
      chunks.push(chunk);
    }
    const fileBuffer = Buffer.concat(chunks);

    if (fileBuffer.length === 0) {
      return reply.status(400).send({
        success: false,
        error: { code: 'EMPTY_FILE', message: 'Photo data is empty.' },
      });
    }

    if (fileBuffer.length > 10 * 1024 * 1024) {
      return reply.status(400).send({
        success: false,
        error: { code: 'FILE_TOO_LARGE', message: 'Photo must be under 10MB.' },
      });
    }

    // ─── 2. Get user's existing profile photos ────────────
    const photosResult = await query(
      `SELECT url FROM ${TABLES.PROFILE_PHOTOS} WHERE user_id = $1 ORDER BY created_at ASC`,
      [userId],
    );
    const profilePhotoUrls: string[] = photosResult.rows.map((r: any) => r.url);

    console.log(
      `[pose-verification] User ${userId} has ${profilePhotoUrls.length} profile photo(s)`,
    );

    // ─── 3. Send selfie + profile photos to pose-service for face matching ─
    const poseServiceUrl = process.env.POSE_SERVICE_URL || 'http://localhost:3004';

    // Encode selfie as base64 to send alongside photo URLs
    const selfieBase64 = fileBuffer.toString('base64');

    let matchResult: {
      match: boolean;
      confidence: number;
      scores: number[];
      face_detected_in_selfie: boolean;
      profile_faces_detected: number;
      rejection_reasons: string[];
    } | null = null;

    try {
      const response = await fetch(`${poseServiceUrl}/verify-face-match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          selfie_base64: selfieBase64,
          profile_photo_urls: profilePhotoUrls,
          min_match_threshold: 0.65,
        }),
        signal: AbortSignal.timeout(30000), // 30s timeout
      });

      if (response.ok) {
        const json = await response.json() as {
          match: boolean;
          confidence: number;
          scores: number[];
          face_detected_in_selfie: boolean;
          profile_faces_detected: number;
          rejection_reasons: string[];
        };
        matchResult = json;
        console.log(
          `[pose-verification] Face match result for user ${userId}:`,
          `match=${json.match}, confidence=${json.confidence}`,
          `scores=[${json.scores.join(', ')}]`,
          `reasons=${json.rejection_reasons.join('; ')}`,
        );
      } else {
        console.error(
          `[pose-verification] Pose-service returned ${response.status}`,
        );
      }
    } catch (err: any) {
      // Pose-service might be down — don't block the user
      console.error(`[pose-verification] Failed to call pose-service: ${err.message}`);
    }

    // ─── 4. Update user verification status ────────────────
    // Set is_verified = TRUE if face match succeeded (match=true and
    // at least 2 profile photos had detectable faces).
    // User can proceed with onboarding regardless of the result.
    if (matchResult && matchResult.match) {
      await query(
        `UPDATE ${TABLES.USERS} SET is_verified = TRUE, liveness_status = 'verified' WHERE id = $1`,
        [userId],
      );
      console.log(
        `[pose-verification] User ${userId} verified via face match (confidence=${matchResult.confidence})`,
      );
    } else if (matchResult && !matchResult.face_detected_in_selfie) {
      // No face in selfie — don't change verification status
      console.log(
        `[pose-verification] No face detected in selfie for user ${userId}`,
      );
    } else {
      // Face match failed or couldn't reach pose-service
      // Just log it; user can proceed without verification
      const reason =
        matchResult?.rejection_reasons?.join('; ') ||
        'Pose-service unreachable — verification skipped';
      console.log(
        `[pose-verification] Face match not confirmed for user ${userId}: ${reason}`,
      );
    }

    // ─── 5. Return success — user can proceed regardless ────
    return reply.status(201).send({
      success: true,
      data: {
        status: matchResult?.match ? 'verified' : 'pending',
        match: matchResult?.match ?? false,
        confidence: matchResult?.confidence ?? 0,
        faceMatchScores: matchResult?.scores ?? [],
        message: matchResult?.match
          ? 'Face verified successfully! Your selfie matches your profile photos.'
          : 'Selfie submitted. You can continue with onboarding.',
      },
    });
  });
}
