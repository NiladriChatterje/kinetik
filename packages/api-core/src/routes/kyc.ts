import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { ERROR_CODES } from '@kinetik/shared';
import { query, TABLES } from '../services/database';
import {
  AadhaarOfflineError,
  ageOn,
  isAadhaarOfflineConfigured,
  verifyOfflineEkyc,
} from '../services/aadhaarOffline';

// ─── MinIO constants (reuse same S3 client pattern as photoStorage) ─

import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

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
        // False when POSE_SERVICE_URL is explicitly set to empty (free hosting
        // intentionally skips the face service) — the app hides the verify
        // action instead of showing 502s. Unset env still means localhost dev.
        faceVerificationAvailable: (process.env.POSE_SERVICE_URL ?? 'http://localhost:3004') !== '',
        // True once the UIDAI signing certificate is present on the server.
        aadhaarOfflineAvailable: isAadhaarOfflineConfigured(),
      },
    });
  });

  // ─── Aadhaar Paperless Offline e-KYC ─────────────────────
  // The user uploads the zip from myAadhaar plus their 4-digit share code.
  // We verify UIDAI's signature, take the date of birth and photo, confirm
  // 18+, match the photo against the profile photos, and keep only: a
  // verified flag, the date of birth, and a hash to stop one Aadhaar
  // verifying many accounts. The zip, XML and photo are never written to
  // disk or object storage.
  app.post('/aadhaar-offline', async (request: FastifyRequest, reply: FastifyReply) => {
    const { sub: userId } = request.user as any;

    if (!isAadhaarOfflineConfigured()) {
      return reply.status(503).send({
        success: false,
        error: { code: 'AADHAAR_UNAVAILABLE', message: 'Aadhaar verification is not available yet.' },
      });
    }

    let zipBuffer: Buffer | null = null;
    let shareCode = '';
    for await (const part of request.parts()) {
      if (part.type === 'field') {
        if (part.fieldname === 'share_code') shareCode = String(part.value ?? '').trim();
      } else if (part.type === 'file') {
        const chunks: Buffer[] = [];
        for await (const chunk of part.file) chunks.push(chunk);
        zipBuffer = Buffer.concat(chunks);
      }
    }
    if (!zipBuffer || zipBuffer.length === 0) {
      return reply.status(400).send({
        success: false,
        error: { code: 'NO_FILE', message: 'Attach the zip downloaded from myAadhaar.' },
      });
    }
    if (zipBuffer.length > 5 * 1024 * 1024) {
      return reply.status(400).send({
        success: false,
        error: { code: 'FILE_TOO_LARGE', message: 'That file is too large to be an Aadhaar e-KYC zip.' },
      });
    }

    // ─── 1. Signature + fields ────────────────────────────
    let ekyc;
    try {
      ekyc = verifyOfflineEkyc(zipBuffer, shareCode);
    } catch (err: any) {
      if (err instanceof AadhaarOfflineError) {
        const status = err.code === 'NOT_CONFIGURED' ? 503 : 400;
        return reply.status(status).send({ success: false, error: { code: err.code, message: err.message } });
      }
      throw err;
    }

    // ─― 2. Age gate from the signed date of birth ─────────
    if (ageOn(ekyc.dateOfBirth) < 18) {
      return reply.status(403).send({
        success: false,
        error: { code: 'UNDERAGE', message: 'You must be 18 or older to use Kinetik.' },
      });
    }

    // ─── 3. One Aadhaar, one account ──────────────────────
    const dup = await query(
      `SELECT id FROM ${TABLES.USERS} WHERE aadhaar_ref_hash = $1 AND id <> $2 LIMIT 1`,
      [ekyc.identityHash, userId],
    );
    if (dup.rows.length > 0) {
      return reply.status(409).send({
        success: false,
        error: { code: 'AADHAAR_ALREADY_USED', message: 'This Aadhaar is already verified on another account.' },
      });
    }

    // ─── 4. Face on the Aadhaar photo vs profile photos ───
    // Mandatory whenever the face service is deployed. When POSE_SERVICE_URL
    // is explicitly empty (service intentionally not deployed) the signature
    // and age checks stand on their own and faceChecked is reported false.
    const poseServiceUrl = process.env.POSE_SERVICE_URL ?? 'http://localhost:3004';
    let faceChecked = false;
    let confidence: number | undefined;
    if (poseServiceUrl !== '') {
      if (!ekyc.photoBase64) {
        return reply.status(400).send({
          success: false,
          error: { code: 'NO_PHOTO', message: 'The e-KYC file has no photo. Download it again from myAadhaar.' },
        });
      }
      const photosResult = await query(
        `SELECT url FROM ${TABLES.PROFILE_PHOTOS} WHERE user_id = $1 ORDER BY created_at ASC`,
        [userId],
      );
      const profilePhotoUrls: string[] = photosResult.rows.map((r: any) => r.url);
      if (profilePhotoUrls.length < 2) {
        return reply.status(400).send({
          success: false,
          error: { code: 'NOT_ENOUGH_PHOTOS', message: 'Add at least 2 profile photos first.' },
        });
      }
      let result: { match: boolean; confidence: number; rejection_reasons?: string[] };
      try {
        const res = await fetch(`${poseServiceUrl}/verify-document-face`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: userId,
            document_image: ekyc.photoBase64,
            profile_photo_urls: profilePhotoUrls,
            min_match_threshold: 0.55,
          }),
          signal: AbortSignal.timeout(30000),
        });
        if (!res.ok) throw new Error(`pose-service ${res.status}`);
        result = (await res.json()) as typeof result;
      } catch (err: any) {
        console.error(`[kyc] Aadhaar face match unavailable for ${userId}: ${err?.message || err}`);
        return reply.status(502).send({
          success: false,
          error: { code: 'VERIFICATION_SERVICE_ERROR', message: 'Verification service temporarily unavailable.' },
        });
      }
      faceChecked = true;
      confidence = result.confidence;
      if (!result.match) {
        return reply.send({
          success: true,
          data: {
            verified: false,
            faceChecked,
            confidence,
            reason: result.rejection_reasons?.[0] || 'Your Aadhaar photo did not match your profile photos.',
          },
        });
      }
    }

    // ─── 5. Persist only what the app needs ───────────────
    await query(
      `UPDATE ${TABLES.USERS}
       SET kyc_status = 'verified', is_verified = TRUE,
           date_of_birth = $2, aadhaar_ref_hash = $3
       WHERE id = $1`,
      [userId, ekyc.dateOfBirth, ekyc.identityHash],
    );
    console.log(`[kyc] Aadhaar offline e-KYC verified for ${userId} (faceChecked=${faceChecked})`);

    return reply.send({
      success: true,
      data: { verified: true, faceChecked, confidence, kycStatus: 'verified' },
    });
  });

  // ─── Verify Face on KYC Document ─────────────────────────
  // Compares the face extracted from the uploaded KYC document
  // against the user's profile photos to confirm identity.
  app.post('/verify-face', async (request: FastifyRequest, reply: FastifyReply) => {
    const { sub: userId } = request.user as any;

    // POSE_SERVICE_URL explicitly set to empty = face service intentionally
    // not deployed (free hosting). Fail fast with a clear "not available"
    // instead of timing out against a host that doesn't exist.
    const poseServiceUrl = process.env.POSE_SERVICE_URL ?? 'http://localhost:3004';
    if (!poseServiceUrl) {
      return reply.status(503).send({
        success: false,
        error: {
          code: 'FACE_VERIFICATION_UNAVAILABLE',
          message: 'ID face verification is not available yet.',
        },
      });
    }

    // ─── 1. Get the latest uploaded KYC document ────────────
    const docResult = await query(
      `SELECT id, document_url, document_type, status
       FROM ${TABLES.KYC_DOCUMENTS}
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId],
    );
    const doc = docResult.rows[0];
    if (!doc) {
      return reply.status(400).send({
        success: false,
        error: { code: 'NO_DOCUMENT', message: 'No KYC document uploaded. Please upload a document first.' },
      });
    }

    // ─── 2. Fetch the document from MinIO ──────────────────
    const client = getS3Client();

    // Extract object key from document URL (e.g. /uploads/kyc/{userId}/{docId}.jpg)
    const objectKey = doc.document_url.replace(PUBLIC_URL, '');

    let documentBuffer: Buffer;
    try {
      const response = await client.send(
        new GetObjectCommand({
          Bucket: BUCKET,
          Key: objectKey,
        }),
      );
      const chunks: Uint8Array[] = [];
      for await (const chunk of response.Body as any) {
        chunks.push(chunk);
      }
      documentBuffer = Buffer.concat(chunks);
    } catch (err: any) {
      console.error(`[kyc] Failed to fetch document from MinIO: ${err.message}`);
      return reply.status(500).send({
        success: false,
        error: { code: 'DOCUMENT_FETCH_FAILED', message: 'Could not retrieve uploaded document.' },
      });
    }

    // ─── 3. Get user's profile photo URLs ───────────────────
    const photosResult = await query(
      `SELECT url FROM ${TABLES.PROFILE_PHOTOS} WHERE user_id = $1 ORDER BY created_at ASC`,
      [userId],
    );
    const profilePhotoUrls: string[] = photosResult.rows.map((r: any) => r.url);

    if (profilePhotoUrls.length < 2) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'NOT_ENOUGH_PHOTOS',
          message: 'You need at least 2 profile photos for face verification. Please upload more photos first.',
        },
      });
    }

    // ─── 4. Send to pose-service for face matching ──────────
    const documentBase64 = documentBuffer.toString('base64');

    try {
      const response = await fetch(`${poseServiceUrl}/verify-document-face`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          document_image: documentBase64,
          profile_photo_urls: profilePhotoUrls,
          min_match_threshold: 0.55,
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        console.error(`[kyc] Pose-service returned ${response.status}`);
        return reply.status(502).send({
          success: false,
          error: { code: 'VERIFICATION_SERVICE_ERROR', message: 'Verification service temporarily unavailable.' },
        });
      }

      const result = await response.json() as {
        match: boolean;
        confidence: number;
        face_detected_in_document: boolean;
        profile_faces_detected: number;
        rejection_reasons: string[];
      };

      console.log(
        `[kyc] Document face verification for user ${userId}: match=${result.match}, confidence=${result.confidence}`,
      );

      // If face on the document matches profile photos, update KYC status
      if (result.match) {
        await query(
          `UPDATE ${TABLES.USERS} SET kyc_status = 'verified', is_verified = TRUE WHERE id = $1`,
          [userId],
        );
        await query(
          `UPDATE ${TABLES.KYC_DOCUMENTS} SET status = 'verified', verified_at = NOW() WHERE user_id = $1`,
          [userId],
        );
      }

      return reply.send({
        success: true,
        data: {
          match: result.match,
          confidence: result.confidence,
          faceDetectedInDocument: result.face_detected_in_document,
          profileFacesDetected: result.profile_faces_detected,
          rejectionReasons: result.rejection_reasons,
          kycStatus: result.match ? 'verified' : 'pending',
        },
      });
    } catch (err: any) {
      console.error(`[kyc] Failed to call pose-service for face verification: ${err.message}`);
      return reply.status(502).send({
        success: false,
        error: { code: 'VERIFICATION_FAILED', message: 'Face verification failed. Please try again.' },
      });
    }
  });
}
