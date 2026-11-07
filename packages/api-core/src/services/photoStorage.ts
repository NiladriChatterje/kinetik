/**
 * Photo storage service — MinIO (S3-compatible) object storage.
 *
 * Uploads profile photos to a MinIO bucket, generates thumbnails via sharp,
 * and returns pre-signed or public URLs.
 *
 * Profile photos and all thumbnails are stored as lossy WebP. Chat photos
 * keep the bytes the phone sent, metadata stripped (see saveChatImage).
 *
 * Bucket structure:
 *   kinetik-photos/{userId}/{photoId}.webp        (profile photo, q88)
 *   kinetik-photos/{userId}/{photoId}_thumb.webp   (thumbnail, 300px, lossy)
 *   kinetik-photos/{userId}/{photoId}.jpg|png|webp (chat photo, as sent)
 *   kinetik-photos/{userId}/{photoId}_thumb.webp   (chat thumbnail, 640px short side)
 *
 * Environment variables:
 *   MINIO_ENDPOINT   — MinIO server address (default: localhost:9000)
 *   MINIO_ACCESS_KEY — Access key (default: minioadmin)
 *   MINIO_SECRET_KEY — Secret key (default: minioadmin)
 *   MINIO_USE_SSL   — Set to "true" for HTTPS (default: false)
 *   MINIO_BUCKET    — Bucket name (default: kinetik-photos)
 *   MINIO_REGION    — S3 region; "auto" for Cloudflare R2 (default: us-east-1)
 *   MINIO_PUBLIC_URL — Public-facing URL for photos (default: /uploads/)
 */

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import type { Metadata as SharpMetadata } from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import { encode } from 'blurhash';
import { encryptBuffer, decryptBuffer } from '@kinetik/shared';
import { ImageMetadataError, sniffImageFormat, stripJpegMetadata, stripPngMetadata } from './imageMetadata';

// ─── sharp tuning for the 0.5 CPU / 256 MB api-core container ────────
// Every image here is processed exactly once, so libvips's operation cache
// (50 MB by default) never gets a hit and only adds to resident memory.
// A single worker thread matches the CPU quota; more threads would only
// contend with each other and raise peak memory per upload.
sharp.cache(false);
sharp.concurrency(1);

// ─── Constants ───────────────────────────────────────────────────────

const ENDPOINT = process.env.MINIO_ENDPOINT || 'localhost:9000';
const ACCESS_KEY = process.env.MINIO_ACCESS_KEY || 'minioadmin';
const SECRET_KEY = process.env.MINIO_SECRET_KEY || 'minioadmin';
const USE_SSL = process.env.MINIO_USE_SSL === 'true';
const BUCKET = process.env.MINIO_BUCKET || 'kinetik-photos';
/** MinIO ignores the region but the S3 SDK demands one. Cloudflare R2 wants "auto". */
const REGION = process.env.MINIO_REGION || 'us-east-1';
/** Public URL prefix for serving images (via nginx or MinIO console) */
const PUBLIC_URL = process.env.MINIO_PUBLIC_URL || '/uploads/';

/** Encryption key for chat media files at rest (same key used for text messages) */
const FILE_ENCRYPTION_KEY = process.env.MESSAGE_ENCRYPTION_KEY || '';

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
      region: REGION,
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
  opts: { lossless?: boolean } = {},
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

  // ── Generate full-res WebP ───────────────────────────────
  // Lossy: lossless effort-6 cost minutes of CPU per photo, and its only
  // consumer (server-side face verification) moved on-device.
  const fullKey = `${userId}/${photoId}.webp`;
  const fullBuffer = await sharp(fileBuffer)
    .webp({ quality: opts.lossless === false ? 82 : 88, effort: 4 })
    .toBuffer();

  // ── Generate thumbnail ──────────────────────────────────
  // Decoded from the original (not the full WebP) so sharp can shrink-on-load
  // for JPEG/WebP input, which is far cheaper than a full-size decode.
  const thumbKey = `${userId}/${photoId}_thumb.webp`;
  const thumbBuffer = await sharp(fileBuffer)
    .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'inside' })
    .webp({ quality: 75, effort: 4 })
    .toBuffer();

  // ── Generate BlurHash ───────────────────────────────────
  // Derived from the 300px thumbnail rather than the original: BlurHash only
  // captures broad colour, so the result is visually identical and this avoids
  // a third decode of the source image.
  const { data: blurRaw, info: blurInfo } = await sharp(thumbBuffer)
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

  // ── Upload both variants concurrently ───────────────────
  // Both objects are fully built at this point, so the two network round
  // trips can overlap. Either failure still rejects the whole save.
  const cacheControl = 'public, max-age=31536000, immutable';
  await Promise.all([
    client.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: fullKey,
        Body: fullBuffer,
        ContentType: 'image/webp',
        CacheControl: cacheControl,
      }),
    ),
    client.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: thumbKey,
        Body: thumbBuffer,
        ContentType: 'image/webp',
        CacheControl: cacheControl,
      }),
    ),
  ]);

  console.log(
    `[photoStorage] Uploaded to minio://${BUCKET}/${fullKey} ` +
      `| original=${(fileBuffer.length / 1024).toFixed(1)}KB ` +
      `full=${(fullBuffer.length / 1024).toFixed(1)}KB ` +
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

// ─── Chat photos ─────────────────────────────────────────────────────
//
// A chat photo is stored as the phone sent it, never re-encoded: the app
// sends the camera's own JPEG (or the PNG) with its metadata stripped
// losslessly, so the receiver sees the original quality. The server strips
// once more (imageMetadata.ts) so that no client, however modified, can
// store a photo that still carries its GPS position. Only the bubble
// thumbnail is made here.
//
// Older app versions send a 1200px WebP with no metadata; that is kept
// as it is too.

/** Short side of the bubble thumbnail. The bubble is 200 x 200 dp, about 600 px on a 3x screen. */
const CHAT_THUMB_SHORT_SIDE = 640;

/**
 * Pixel ceiling for a chat photo. The app sends at most 4096 x 4096
 * (16.8 MP); the headroom covers older versions, which scaled every photo
 * to 1200 px wide, so a long screenshot could be very tall. Checked from the
 * header before anything is decoded.
 */
export const CHAT_IMAGE_MAX_PIXELS = 25_000_000;

/** A chat photo the server will not store: the message is for the sender. */
export class ChatImageRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChatImageRejected';
  }
}

export interface CleanChatImage {
  buffer: Buffer;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  ext: 'jpg' | 'png' | 'webp';
}

function toBuffer(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length);
}

/**
 * The bytes to store for a chat photo, free of metadata. JPEG and PNG are
 * stripped without touching the pixels; a WebP without metadata (what older
 * app versions send) is kept; anything else, or a file the strippers will
 * not vouch for, is re-encoded once at high quality, which also drops all
 * metadata (sharp writes none unless asked).
 */
export async function cleanChatImage(input: Buffer): Promise<CleanChatImage> {
  if (input.length === 0) throw new ChatImageRejected('That photo is empty.');
  if (input.length > MAX_FILE_SIZE) throw new ChatImageRejected('That photo is too large. Max 10 MB.');

  let meta: SharpMetadata;
  try {
    // Header only, nothing is decoded; the pixel ceiling is checked just below
    meta = await sharp(input, { limitInputPixels: false }).metadata();
  } catch {
    throw new ChatImageRejected('That file is not a photo we can show.');
  }
  if (!meta.width || !meta.height) throw new ChatImageRejected('That file is not a photo we can show.');
  if (meta.width * meta.height > CHAT_IMAGE_MAX_PIXELS) {
    throw new ChatImageRejected('That photo has too many pixels to send.');
  }

  const bytes = new Uint8Array(input.buffer, input.byteOffset, input.length);
  try {
    if (meta.format === 'jpeg' && sniffImageFormat(bytes) === 'jpeg') {
      return { buffer: toBuffer(stripJpegMetadata(bytes).bytes), mimeType: 'image/jpeg', ext: 'jpg' };
    }
    if (meta.format === 'png' && sniffImageFormat(bytes) === 'png') {
      return { buffer: toBuffer(stripPngMetadata(bytes).bytes), mimeType: 'image/png', ext: 'png' };
    }
  } catch (err) {
    if (!(err instanceof ImageMetadataError)) throw err;
    // Falls through to the re-encode below
  }
  if (meta.format === 'webp' && !meta.exif && !meta.xmp && !meta.iptc && (meta.pages ?? 1) === 1) {
    return { buffer: input, mimeType: 'image/webp', ext: 'webp' };
  }

  try {
    const buffer = await sharp(input, { limitInputPixels: CHAT_IMAGE_MAX_PIXELS })
      .rotate() // apply the orientation before it is dropped with the rest
      .jpeg({ quality: 92 })
      .toBuffer();
    return { buffer, mimeType: 'image/jpeg', ext: 'jpg' };
  } catch {
    throw new ChatImageRejected('That file is not a photo we can show.');
  }
}

/** The bubble thumbnail: upright, short side 640 px (never enlarged), WebP. */
export async function makeChatThumbnail(image: Buffer): Promise<Buffer> {
  try {
    return await sharp(image, { limitInputPixels: CHAT_IMAGE_MAX_PIXELS })
      .rotate()
      .resize(CHAT_THUMB_SHORT_SIDE, CHAT_THUMB_SHORT_SIDE, { fit: 'outside', withoutEnlargement: true })
      .webp({ quality: 80, effort: 4 })
      .toBuffer();
  } catch {
    throw new ChatImageRejected('That file is not a photo we can show.');
  }
}

/**
 * Store a chat photo and its bubble thumbnail. Throws ChatImageRejected
 * when the file itself is the problem; any other error is storage.
 */
export async function saveChatImage(
  userId: string,
  input: Buffer,
): Promise<{ url: string; thumbnailUrl: string; mimeType: string; sizeBytes: number }> {
  const clean = await cleanChatImage(input);
  const thumbBuffer = await makeChatThumbnail(clean.buffer);

  const photoId = uuidv4();
  const fullKey = `${userId}/${photoId}.${clean.ext}`;
  const thumbKey = `${userId}/${photoId}_thumb.webp`;
  const client = getS3Client();
  const cacheControl = 'public, max-age=31536000, immutable';
  await Promise.all([
    client.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: fullKey,
      Body: clean.buffer,
      ContentType: clean.mimeType,
      CacheControl: cacheControl,
    })),
    client.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: thumbKey,
      Body: thumbBuffer,
      ContentType: 'image/webp',
      CacheControl: cacheControl,
    })),
  ]);

  console.log(
    `[photoStorage] Chat photo minio://${BUCKET}/${fullKey} ` +
      `| received=${(input.length / 1024).toFixed(1)}KB stored=${(clean.buffer.length / 1024).toFixed(1)}KB ` +
      `${clean.mimeType} thumb=${(thumbBuffer.length / 1024).toFixed(1)}KB`,
  );

  return {
    url: `${PUBLIC_URL}${fullKey}`,
    thumbnailUrl: `${PUBLIC_URL}${thumbKey}`,
    mimeType: clean.mimeType,
    sizeBytes: clean.buffer.length,
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
/**
 * Save a chat media file to MinIO (any type — image, video, audio, doc).
 * Unlike savePhoto, this stores the file as-is without sharp processing.
 */
export async function saveChatFile(
  userId: string,
  fileBuffer: Buffer,
  mimeType: string,
  fileId: string,
): Promise<{ url: string }> {
  const ext = mimeType.split('/')[1] || 'bin';
  const key = `chat/${userId}/${fileId}.${ext}`;
  const client = getS3Client();

  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: fileBuffer,
      ContentType: mimeType,
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );

  return { url: `${PUBLIC_URL}${key}` };
}

/**
 * Save a chat media file with encryption at rest.
 * The file buffer is encrypted with AES-256-GCM before being stored in MinIO.
 * The returned URL points to the authenticated proxy endpoint that decrypts on-the-fly.
 */
export async function saveEncryptedChatFile(
  userId: string,
  fileBuffer: Buffer,
  mimeType: string,
  fileId: string,
): Promise<{ url: string }> {
  // Derive file extension from MIME type
  let ext = mimeType.split('/')[1] || 'bin';
  // 'audio/mp4' should map to 'm4a' not 'mp4' — the audio player needs the
  // correct Content-Type to play, and the proxy maps 'm4a' → 'audio/mp4'.
  if (ext === 'mp4' && mimeType.startsWith('audio/')) ext = 'm4a';
  if (ext === 'x-m4a') ext = 'm4a';
  const key = `chat/${userId}/${fileId}.enc`; // always .enc extension for encrypted files
  const client = getS3Client();

  // Encrypt the buffer before storage
  const encryptedBuffer = encryptBuffer(fileBuffer, FILE_ENCRYPTION_KEY);

  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: encryptedBuffer,
      ContentType: 'application/octet-stream', // hide original MIME type
      CacheControl: 'private, no-cache',        // never cache encrypted data
    }),
  );

  // URL points to the authenticated proxy endpoint that decrypts on-the-fly
  const proxyUrl = `/api/v1/matches/media/${key}?ext=${ext}`;

  console.log(
    `[photoStorage] Encrypted chat file saved: ${key} ` +
      `| original=${(fileBuffer.length / 1024).toFixed(1)}KB ` +
      `encrypted=${(encryptedBuffer.length / 1024).toFixed(1)}KB`,
  );

  return { url: proxyUrl };
}

/**
 * Read an encrypted chat file from MinIO and decrypt it.
 * Returns the original plaintext Buffer and MIME type for streaming.
 */
export async function getEncryptedChatFileBuffer(
  key: string,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const client = getS3Client();

  const response = await client.send(
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
    }),
  );

  // Read the stream into a buffer
  const chunks: Buffer[] = [];
  for await (const chunk of response.Body as any) {
    chunks.push(Buffer.from(chunk));
  }
  const encryptedBuffer = Buffer.concat(chunks);

  // Decrypt
  const plainBuffer = decryptBuffer(encryptedBuffer, FILE_ENCRYPTION_KEY);

  return { buffer: plainBuffer, mimeType: 'application/octet-stream' };
}

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

/**
 * Delete every KYC document a user uploaded (objects under `kyc/{userId}/`).
 * Called on account deletion so the ID file itself goes, not just its row.
 */
export async function deleteAllUserKycDocuments(userId: string): Promise<void> {
  const client = getS3Client();

  const listed = await client.send(
    new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: `kyc/${userId}/`,
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

  console.log(`[photoStorage] Deleted ${listed.Contents.length} KYC objects for user ${userId}`);
}

/**
 * Delete a single chat media file from MinIO by its storage key.
 * Used for one-time view media cleanup after the media has been viewed.
 * The key should be the full path within the bucket (e.g. "chat/{userId}/{fileId}.enc").
 */
export async function deleteChatFile(key: string): Promise<void> {
  const client = getS3Client();

  await client.send(
    new DeleteObjectCommand({
      Bucket: BUCKET,
      Key: key,
    }),
  );

  console.log(`[photoStorage] Deleted chat file: minio://${BUCKET}/${key}`);
}
