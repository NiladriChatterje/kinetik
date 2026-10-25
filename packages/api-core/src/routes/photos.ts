import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ERROR_CODES } from '@kinetik/shared';
import { query, TABLES, getPhotosByUserId, deletePhotoById, setPrimaryPhoto } from '../services/database';
import { savePhoto, deletePhoto } from '../services/photoStorage';

/**
 * A finished profile keeps at least this many photos. Onboarding is exempt:
 * the user is still assembling the set there and may swap a photo out while
 * at two. The profile page disables its delete action at this count; this is
 * the server-side guarantee behind it.
 */
const MIN_PROFILE_PHOTOS = 2;

export async function photoRoutes(app: FastifyInstance) {
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

  // ─── Get Photos ────────────────────────────────────────
  app.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const { sub: userId } = request.user as any;
    const photos = await getPhotosByUserId(userId);
    return reply.send({ success: true, data: photos });
  });

  // ─── Upload Photo ───────────────────────────────────────
  app.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const { sub: userId } = request.user as any;

    // Check photo limit (max 6). The next order index follows the highest in
    // use, not the count: after a deletion the count would repeat an index.
    const countResult = await query(
      `SELECT COUNT(*)::int AS count,
              COALESCE(MAX(order_index), -1) + 1 AS next_index,
              COUNT(*) FILTER (WHERE is_primary)::int AS primaries
       FROM ${TABLES.PROFILE_PHOTOS} WHERE user_id = $1`,
      [userId],
    );
    const currentCount = Number(countResult.rows[0]?.count ?? 0);
    const nextIndex = Number(countResult.rows[0]?.next_index ?? 0);
    const hasPrimary = Number(countResult.rows[0]?.primaries ?? 0) > 0;
    if (currentCount >= 6) {
      return reply.status(400).send({
        success: false,
        error: { code: 'PHOTO_LIMIT', message: 'Maximum 6 photos allowed.' },
      });
    }

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

    // Save to MinIO + generate thumbnail
    let saved;
    try {
      saved = await savePhoto(userId, fileBuffer, mimeType);
    } catch (err: any) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_FILE', message: err.message },
      });
    }

    // Insert DB record. A profile with photos always has a primary one (the
    // face everyone else sees first): the first photo becomes it, and so does
    // a new photo whenever none is primary.
    const dbResult = await query(
      `INSERT INTO ${TABLES.PROFILE_PHOTOS} (user_id, url, thumbnail_url, blur_hash, order_index, is_primary)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, url, thumbnail_url, blur_hash, is_primary, order_index, created_at`,
      [userId, saved.url, saved.thumbnailUrl, saved.blurHash, nextIndex, !hasPrimary],
    );

    return reply.status(201).send({ success: true, data: dbResult.rows[0] });
  });

  // ─── Delete Photo ───────────────────────────────────────
  app.delete('/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { sub: userId } = request.user as any;
    const { id } = request.params;

    // Get photo record to know the filename
    const photoResult = await query(
      `SELECT id, url, is_primary FROM ${TABLES.PROFILE_PHOTOS} WHERE id = $1 AND user_id = $2`,
      [id, userId],
    );
    const photo = photoResult.rows[0];
    if (!photo) {
      return reply.status(404).send({
        success: false,
        error: { code: ERROR_CODES.NOT_FOUND, message: 'Photo not found.' },
      });
    }

    // A completed profile may not drop below the minimum
    const guard = await query(
      `SELECT u.onboarding_complete,
              (SELECT COUNT(*)::int FROM ${TABLES.PROFILE_PHOTOS} p WHERE p.user_id = u.id) AS photo_count
       FROM ${TABLES.USERS} u WHERE u.id = $1`,
      [userId],
    );
    const { onboarding_complete: onboardingComplete, photo_count: photoCount } = guard.rows[0] ?? {};
    if (onboardingComplete && photoCount <= MIN_PROFILE_PHOTOS) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'NOT_ENOUGH_PHOTOS',
          message: `Keep at least ${MIN_PROFILE_PHOTOS} photos on your profile. Add another photo before deleting this one.`,
        },
      });
    }

    // The primary photo is the face everyone else sees (chat list, chat
    // header, likes, pushes), and on a finished profile it only changes
    // after the app's selfie check (PUT /:id/primary). So it cannot be
    // deleted while other photos remain: another photo is made primary
    // first. During onboarding the selfie step is still ahead, so the next
    // photo simply takes over. Either way a profile with photos is never
    // left without a primary one, which once emptied every chat avatar.
    const primaryOfSeveral = photo.is_primary && photoCount > 1;
    if (primaryOfSeveral && onboardingComplete) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'PRIMARY_PHOTO',
          message: 'This is your main photo. Make another photo your main photo first.',
        },
      });
    }

    // Delete from DB
    await deletePhotoById(id, userId);
    if (primaryOfSeveral) {
      await query(
        `UPDATE ${TABLES.PROFILE_PHOTOS} SET is_primary = TRUE
         WHERE id = (SELECT id FROM ${TABLES.PROFILE_PHOTOS} WHERE user_id = $1
                     ORDER BY order_index ASC, created_at ASC LIMIT 1)`,
        [userId],
      );
    }

    // Delete from MinIO (fire-and-forget)
    // The route param `id` is already the photo's UUID — use it directly as the S3 key.
    deletePhoto(userId, id).catch(() => {});

    return reply.send({ success: true });
  });

  // ─── Set Primary Photo ──────────────────────────────────
  app.put('/:id/primary', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { sub: userId } = request.user as any;
    const { id } = request.params;

    const updated = await setPrimaryPhoto(id, userId);
    if (!updated) {
      return reply.status(404).send({
        success: false,
        error: { code: ERROR_CODES.NOT_FOUND, message: 'Photo not found.' },
      });
    }

    return reply.send({ success: true, data: updated });
  });

  // ─── Reorder Photos ─────────────────────────────────────
  app.put('/reorder', async (request: FastifyRequest, reply: FastifyReply) => {
    const { sub: userId } = request.user as any;
    const { photoIds } = request.body as { photoIds: string[] };

    if (!Array.isArray(photoIds)) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'photoIds must be an array.' },
      });
    }

    // Update order_index for each photo
    for (let i = 0; i < photoIds.length; i++) {
      await query(
        `UPDATE ${TABLES.PROFILE_PHOTOS} SET order_index = $1 WHERE id = $2 AND user_id = $3`,
        [i, photoIds[i], userId],
      );
    }

    return reply.send({ success: true });
  });
}
