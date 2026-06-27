/**
 * Photo storage service — MinIO (S3-compatible) object storage.
 *
 * Uploads profile photos to a MinIO bucket, generates thumbnails via sharp,
 * and returns pre-signed or public URLs.
 *
 * Bucket structure:
 *   kinetik-photos/{userId}/{photoId}.webp        (full-res)
 *   kinetik-photos/{userId}/{photoId}_thumb.webp   (thumbnail, 300px)
 *
 * Environment variables:
 *   MINIO_ENDPOINT   — MinIO server address (default: localhost:9000)
 *   MINIO_ACCESS_KEY — Access key (default: minioadmin)
 *   MINIO_SECRET_KEY — Secret key (default: minioadmin)
 *   MINIO_USE_SSL   — Set to "true" for HTTPS (default: false)
 *   MINIO_BUCKET    — Bucket name (default: kinetik-photos)
 *   MINIO_PUBLIC_URL — Public-facing URL for photos (default: /uploads/)
 */

import { S3Client, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import { encode } from 'blurhash';

// ─── Constants ───────────────────────────────────────────────────────

const ENDPOINT = process.env.MINIO_ENDPOINT || 'localhost:9000';
const ACCESS_KEY = process.env.MINIO_ACCESS_KEY || 'minioadmin';
const SECRET_KEY = process.env.MINIO_SECRET_KEY || 'minioadmin';
const USE_SSL = process.env.MINIO_USE_SSL === 'true';
const BUCKET = process.env.MINIO_BUCKET || 'kinetik-photos';
/** Public URL prefix for serving images (via nginx or MinIO console) */
const PUBLIC_URL = process.env.MINIO_PUBLIC_URL || '/uploads/';

/** Thumbnail max dimension */
const THUMB_SIZE = 300;

/** BlurHash generation — resize to this tiny size before encoding for performance.
 *  BlurHash only captures broad color distributions, so 32px is plenty. */
const BLUR_HASH_SIZE = 32;

/** BlurHash component count (X × Y). 4×3 gives a good balance of quality vs. hash length. */
const BLUR_HASH_COMPONENTS = { x: 4, y: 3 } as const;

/** Allowed MIME types for upload */
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

/** Max file size: 10 MB */
const MAX_FILE_SIZE = 10 * 1024 * 1024;

// ─── S3 Client ───────────────────────────────────────────────────────

let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      endpoint: `http${USE_SSL ? 's' : ''}://${ENDPOINT}`,
      region: 'us-east-1', // MinIO ignores region but S3 SDK requires it
      credentials: {
        accessKeyId: ACCESS_KEY,
        secretAccessKey: SECRET_KEY,
      },
      forcePathStyle: true, // Required for MinIO (uses path-style instead of virtual-hosted)
    });
    console.log(`[photoStorage] MinIO client initialized — endpoint=${ENDPOINT}, bucket=${BUCKET}`);
  }
  return s3Client;
}

// ─── Public API ──────────────────────────────────────────────────────

export interface SavedPhoto {
  /** Unique photo ID (UUID) */
  id: string;
  /** Public URL for the full-resolution image */
  url: string;
  /** Public URL for the thumbnail */
  thumbnailUrl: string;
  /** BlurHash string for progressive image loading on the client */
  blurHash: string;
}

/**
 * Upload a photo buffer to MinIO, generating both a full-res version
 * and a thumbnail.
 */
export async function savePhoto(
  userId: string,
  fileBuffer: Buffer,
  mimeType: string,
): Promise<SavedPhoto> {
  // Validate
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new Error(`Unsupported file type: ${mimeType}. Allowed: JPEG, PNG, WebP, HEIC.`);
  }
  if (fileBuffer.length > MAX_FILE_SIZE) {
    throw new Error(`File too large (${(fileBuffer.length / 1024 / 1024).toFixed(1)}MB). Max: 10MB.`);
  }

  const photoId = uuidv4();
  const client = getS3Client();

  // ── Generate full-res WebP ──────────────────────────────
  const fullKey = `${userId}/${photoId}.webp`;
  const fullBuffer = await sharp(fileBuffer).webp({ quality: 85, effort: 6 }).toBuffer();

  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: fullKey,
      Body: fullBuffer,
      ContentType: 'image/webp',
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );

  // ── Generate thumbnail ──────────────────────────────────
  const thumbKey = `${userId}/${photoId}_thumb.webp`;
  const thumbBuffer = await sharp(fileBuffer)
    .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover', position: 'centre' })
    .webp({ quality: 75, effort: 4 })
    .toBuffer();

  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: thumbKey,
      Body: thumbBuffer,
      ContentType: 'image/webp',
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );

  // ── Generate BlurHash ───────────────────────────────────
  // Resize to a tiny square to keep encoding fast — BlurHash only needs broad color info.
  const { data: blurRaw, info: blurInfo } = await sharp(fileBuffer)
    .resize(BLUR_HASH_SIZE, BLUR_HASH_SIZE, { fit: 'cover', position: 'centre' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const blurHash = encode(
    new Uint8ClampedArray(blurRaw),
    blurInfo.width,
    blurInfo.height,
    BLUR_HASH_COMPONENTS.x,
    BLUR_HASH_COMPONENTS.y,
  );

  console.log(
    `[photoStorage] Uploaded to minio://${BUCKET}/${fullKey} ` +
      `| full=${(fullBuffer.length / 1024).toFixed(1)}KB ` +
      `thumb=${(thumbBuffer.length / 1024).toFixed(1)}KB ` +
      `blur=${blurHash.length}ch`,
  );

  return {
    id: photoId,
    url: `${PUBLIC_URL}${fullKey}`,
    thumbnailUrl: `${PUBLIC_URL}${thumbKey}`,
    blurHash,
  };
}

/**
 * Delete a photo and its thumbnail from MinIO.
 */
export async function deletePhoto(userId: string, photoId: string): Promise<void> {
  const client = getS3Client();
  const keys = [
    `${userId}/${photoId}.webp`,
    `${userId}/${photoId}_thumb.webp`,
  ];

  await Promise.all(
    keys.map((key) =>
      client
        .send(
          new DeleteObjectCommand({
            Bucket: BUCKET,
            Key: key,
          }),
        )
        .catch(() => {}),
    ),
  );

  console.log(`[photoStorage] Deleted minio://${BUCKET}/${userId}/${photoId}.*`);
}

/**
 * Delete ALL photos for a user (e.g., when account is deleted).
 */
export async function deleteAllUserPhotos(userId: string): Promise<void> {
  const client = getS3Client();

  // List all objects with the user's prefix
  const listed = await client.send(
    new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: `${userId}/`,
    }),
  );

  if (!listed.Contents?.length) return;

  await Promise.all(
    listed.Contents.map((obj) =>
      client
        .send(
          new DeleteObjectCommand({
            Bucket: BUCKET,
            Key: obj.Key!,
          }),
        )
        .catch(() => {}),
    ),
  );

  console.log(`[photoStorage] Deleted ${listed.Contents.length} objects for user ${userId}`);
}
