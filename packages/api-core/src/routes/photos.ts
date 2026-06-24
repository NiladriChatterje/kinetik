import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ERROR_CODES } from '@kinetik/shared';
import { query, TABLES, getPhotosByUserId, deletePhotoById, setPrimaryPhoto } from '../services/database';
import { savePhoto, deletePhoto } from '../services/photoStorage';

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

    // Check photo limit (max 6)
    const countResult = await query(
      `SELECT COUNT(*) as count FROM ${TABLES.PROFILE_PHOTOS} WHERE user_id = $1`,
      [userId],
    );
    const currentCount = parseInt(countResult.rows[0]?.count ?? '0', 10);
    if (currentCount >= 6) {
      return reply.status(400).send({
        success: false,
        error: { code: 'PHOTO_LIMIT', message: 'Maximum 6 photos allowed.' },
      });
    }

    // Process the uploaded file
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

    // Save to disk + generate thumbnail
    let saved;
    try {
      saved = await savePhoto(userId, fileBuffer, mimeType);
    } catch (err: any) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_FILE', message: err.message },
      });
    }

    // Insert DB record
    const orderIndex = currentCount; // 0-indexed
    const dbResult = await query(
      `INSERT INTO ${TABLES.PROFILE_PHOTOS} (user_id, url, thumbnail_url, order_index)
       VALUES ($1, $2, $3, $4)
       RETURNING id, url, thumbnail_url, is_primary, order_index, created_at`,
      [userId, saved.url, saved.thumbnailUrl, orderIndex],
    );

    // If this is the user's first photo, make it primary automatically
    if (currentCount === 0) {
      await query(
        `UPDATE ${TABLES.PROFILE_PHOTOS} SET is_primary = TRUE WHERE id = $1`,
        [dbResult.rows[0].id],
      );
      dbResult.rows[0].is_primary = true;
    }

    return reply.status(201).send({ success: true, data: dbResult.rows[0] });
  });

  // ─── Delete Photo ───────────────────────────────────────
  app.delete('/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { sub: userId } = request.user as any;
    const { id } = request.params;

    // Get photo record to know the filename
    const photoResult = await query(
      `SELECT id, url FROM ${TABLES.PROFILE_PHOTOS} WHERE id = $1 AND user_id = $2`,
      [id, userId],
    );
    const photo = photoResult.rows[0];
    if (!photo) {
      return reply.status(404).send({
        success: false,
        error: { code: ERROR_CODES.NOT_FOUND, message: 'Photo not found.' },
      });
    }

    // Delete from DB
    await deletePhotoById(id, userId);

    // Delete from disk (fire-and-forget)
    const urlPath = photo.url as string;
    const urlParts = urlPath.split('/');
    const filename = urlParts[urlParts.length - 1]; // e.g. "uuid.webp"
    const photoId = filename.replace('.webp', '');
    deletePhoto(userId, photoId).catch(() => {});

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
