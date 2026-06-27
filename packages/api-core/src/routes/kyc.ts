import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { ERROR_CODES } from '@kinetik/shared';
import { query, TABLES } from '../services/database';

// ─── MinIO constants (reuse same S3 client pattern as photoStorage) ─

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const ENDPOINT = process.env.MINIO_ENDPOINT || 'localhost:9000';
const ACCESS_KEY = process.env.MINIO_ACCESS_KEY || 'minioadmin';
const SECRET_KEY = process.env.MINIO_SECRET_KEY || 'minioadmin';
const USE_SSL = process.env.MINIO_USE_SSL === 'true';
const BUCKET = process.env.MINIO_BUCKET || 'kinetik-photos';
const PUBLIC_URL = process.env.MINIO_PUBLIC_URL || '/uploads/';

/** Allowed document types */
const ALLOWED_DOC_TYPES = new Set(['passport', 'license', 'national_id']);

/** Allowed MIME types for KYC documents */
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'application/pdf',
]);

/** Max file size: 20 MB (PDFs can be larger than photos) */
const MAX_FILE_SIZE = 20 * 1024 * 1024;

let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      endpoint: `http${USE_SSL ? 's' : ''}://${ENDPOINT}`,
      region: 'us-east-1',
      credentials: {
        accessKeyId: ACCESS_KEY,
        secretAccessKey: SECRET_KEY,
      },
      forcePathStyle: true,
    });
  }
  return s3Client;
}

export async function kycRoutes(app: FastifyInstance) {
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

  // ─── Upload KYC Document ─────────────────────────────────
  app.post('/documents', async (request: FastifyRequest, reply: FastifyReply) => {
    const { sub: userId } = request.user as any;

    // Parse multipart — includes file + document_type field
    const parts = request.parts();
    let fileBuffer: Buffer | null = null;
    let mimeType: string = 'application/octet-stream';
    let docType: string = '';
    let originalFileName: string = 'document';

    for await (const part of parts) {
      if (part.type === 'field') {
        if (part.fieldname === 'document_type') {
          docType = part.value as string;
        }
      } else if (part.type === 'file') {
        mimeType = part.mimetype;
        originalFileName = part.filename || 'document';
        const chunks: Buffer[] = [];
        for await (const chunk of part.file) {
          chunks.push(chunk);
        }
        fileBuffer = Buffer.concat(chunks);
      }
    }

    // ─── Validate document type ──────────────────────────
    if (!docType || !ALLOWED_DOC_TYPES.has(docType)) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'INVALID_DOC_TYPE',
          message: `Invalid document type. Must be one of: ${[...ALLOWED_DOC_TYPES].join(', ')}`,
        },
      });
    }

    // ─── Validate file ──────────────────────────────────
    if (!fileBuffer || fileBuffer.length === 0) {
      return reply.status(400).send({
        success: false,
        error: { code: 'NO_FILE', message: 'No document file provided.' },
      });
    }

    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'UNSUPPORTED_FILE_TYPE',
          message: `Unsupported file type: ${mimeType}. Allowed: JPEG, PNG, PDF.`,
        },
      });
    }

    if (fileBuffer.length > MAX_FILE_SIZE) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'FILE_TOO_LARGE',
          message: `File too large (${(fileBuffer.length / 1024 / 1024).toFixed(1)}MB). Max: 20MB.`,
        },
      });
    }

    // ─── Upload to MinIO ────────────────────────────────
    const documentId = uuidv4();
    const extension = mimeType === 'application/pdf' ? 'pdf' : mimeType === 'image/png' ? 'png' : 'jpg';
    const objectKey = `kyc/${userId}/${documentId}.${extension}`;
    const client = getS3Client();

    try {
      await client.send(
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: objectKey,
          Body: fileBuffer,
          ContentType: mimeType,
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
    } catch (err: any) {
      console.error(`[kyc] MinIO upload failed for user ${userId}: ${err.message}`);
      return reply.status(500).send({
        success: false,
        error: { code: 'UPLOAD_FAILED', message: 'Failed to store document. Please try again.' },
      });
    }

    const documentUrl = `${PUBLIC_URL}${objectKey}`;

    console.log(
      `[kyc] Uploaded document for user ${userId}: type=${docType}, key=${objectKey}, size=${(fileBuffer.length / 1024).toFixed(1)}KB`,
    );

    // ─── Insert DB record ───────────────────────────────
    const dbResult = await query(
      `INSERT INTO ${TABLES.KYC_DOCUMENTS} (user_id, document_type, document_url, status)
       VALUES ($1, $2, $3, 'pending')
       RETURNING id, document_type, status, created_at`,
      [userId, docType, documentUrl],
    );

    // ─── Update user's kyc_status ───────────────────────
    await query(
      `UPDATE ${TABLES.USERS} SET kyc_status = 'pending' WHERE id = $1`,
      [userId],
    );

    console.log(`[kyc] KYC status set to 'pending' for user ${userId}`);

    return reply.status(201).send({
      success: true,
      data: {
        id: dbResult.rows[0].id,
        documentType: dbResult.rows[0].document_type,
        status: dbResult.rows[0].status,
        fileName: originalFileName,
        url: documentUrl,
      },
    });
  });

  // ─── Get KYC Documents ───────────────────────────────────
  app.get('/documents', async (request: FastifyRequest, reply: FastifyReply) => {
    const { sub: userId } = request.user as any;

    const result = await query(
      `SELECT id, document_type, document_url, status, rejection_reason, created_at, verified_at
       FROM ${TABLES.KYC_DOCUMENTS}
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId],
    );

    return reply.send({ success: true, data: result.rows });
  });

  // ─── Get KYC Status ──────────────────────────────────────
  app.get('/status', async (request: FastifyRequest, reply: FastifyReply) => {
    const { sub: userId } = request.user as any;

    const userResult = await query(
      `SELECT kyc_status FROM ${TABLES.USERS} WHERE id = $1`,
      [userId],
    );

    const docResult = await query(
      `SELECT id, document_type, status, created_at
       FROM ${TABLES.KYC_DOCUMENTS}
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId],
    );

    return reply.send({
      success: true,
      data: {
        kycStatus: userResult.rows[0]?.kyc_status || 'unverified',
        latestDocument: docResult.rows[0] || null,
      },
    });
  });
}
