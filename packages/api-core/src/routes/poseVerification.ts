import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ERROR_CODES } from '@kinetik/shared';
import { query, TABLES } from '../services/database';
import { savePhoto } from '../services/photoStorage';

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

  // ─── Submit Pose Verification Photo ────────────────────
  app.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const { sub: userId } = request.user as any;

    // Process the uploaded file (multipart via @fastify/multipart)
    const file = await request.file();
    if (!file) {
      return reply.status(400).send({
        success: false,
        error: { code: 'NO_FILE', message: 'No photo file provided.' },
      });
    }

    const mimeType = file.mimetype;

    // Read the file buffer
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

    // Validate file size (max 10MB)
    if (fileBuffer.length > 10 * 1024 * 1024) {
      return reply.status(400).send({
        success: false,
        error: { code: 'FILE_TOO_LARGE', message: 'Photo must be under 10MB.' },
      });
    }

    // Save to MinIO
    let saved;
    try {
      saved = await savePhoto(userId, fileBuffer, mimeType);
    } catch (err: any) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_FILE', message: err.message },
      });
    }

    // Update user's liveness_status to 'pending' and store the photo URL
    await query(
      `UPDATE ${TABLES.USERS} SET liveness_status = 'pending', pose_photo_url = $1 WHERE id = $2`,
      [saved.url, userId],
    );

    console.log(`[pose-verification] Photo uploaded for user ${userId}, liveness_status set to pending`);

    // Fire-and-forget: call the pose-service to verify the selfie asynchronously.
    // The pose-service will update liveness_status to 'verified' or 'rejected'.
    const poseServiceUrl = process.env.POSE_SERVICE_URL || 'http://localhost:3004';
    fetch(`${poseServiceUrl}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        photo_url: saved.url,
      }),
    }).catch((err) => {
      console.error(`[pose-verification] Failed to call pose-service: ${err.message}`);
    });

    return reply.status(201).send({
      success: true,
      data: {
        photoUrl: saved.url,
        thumbnailUrl: saved.thumbnailUrl,
        status: 'pending',
      },
    });
  });
}
