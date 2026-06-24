/**
 * Photo storage service.
 *
 * Saves uploaded profile photos to the local filesystem and generates
 * smaller thumbnail versions using sharp.
 *
 * Directory structure:
 *   uploads/photos/{userId}/{uuid}.webp       (full-res)
 *   uploads/photos/{userId}/{uuid}_thumb.webp  (thumbnail, 300px)
 */

import path from 'path';
import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';

// ─── Constants ───────────────────────────────────────────────────────

// Use __dirname to always resolve relative to the api-core package,
// regardless of where the process was started from.
const UPLOAD_ROOT = process.env.UPLOAD_DIR || path.resolve(__dirname, '../../uploads');
const PHOTOS_DIR = path.join(UPLOAD_ROOT, 'photos');

/** Thumbnail max dimension */
const THUMB_SIZE = 300;

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

// ─── Public API ──────────────────────────────────────────────────────

export interface SavedPhoto {
  /** Unique filename (without extension) */
  id: string;
  /** URL path for the full-resolution image */
  url: string;
  /** URL path for the thumbnail */
  thumbnailUrl: string;
}

/**
 * Save an uploaded photo buffer to disk, generate a thumbnail.
 *
 * @returns The saved photo metadata (id, url, thumbnailUrl)
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
  const userDir = path.join(PHOTOS_DIR, userId);

  // Ensure directory exists
  await fs.mkdir(userDir, { recursive: true });

  // Save full-resolution image as WebP
  const fullFilename = `${photoId}.webp`;
  const fullPath = path.join(userDir, fullFilename);

  const fullImage = sharp(fileBuffer).webp({ quality: 85, effort: 6 });
  await fullImage.toFile(fullPath);

  // Generate and save thumbnail
  const thumbFilename = `${photoId}_thumb.webp`;
  const thumbPath = path.join(userDir, thumbFilename);

  const thumbImage = sharp(fileBuffer)
    .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover', position: 'centre' })
    .webp({ quality: 75, effort: 4 });
  await thumbImage.toFile(thumbPath);

  // Log file sizes
  const fullStat = await fs.stat(fullPath);
  const thumbStat = await fs.stat(thumbPath);
  console.log(
    `[photoStorage] Saved ${fullFilename}: ${(fullStat.size / 1024).toFixed(1)}KB, ` +
      `thumbnail: ${(thumbStat.size / 1024).toFixed(1)}KB`,
  );

  return {
    id: photoId,
    url: `/uploads/photos/${userId}/${fullFilename}`,
    thumbnailUrl: `/uploads/photos/${userId}/${thumbFilename}`,
  };
}

/**
 * Delete a photo and its thumbnail from disk.
 */
export async function deletePhoto(userId: string, photoId: string): Promise<void> {
  const fullPath = path.join(PHOTOS_DIR, userId, `${photoId}.webp`);
  const thumbPath = path.join(PHOTOS_DIR, userId, `${photoId}_thumb.webp`);

  await Promise.allSettled([
    fs.unlink(fullPath).catch(() => {}),
    fs.unlink(thumbPath).catch(() => {}),
  ]);
}

/**
 * Get the absolute filesystem path for a photo URL.
 */
export function resolvePhotoPath(photoUrl: string): string {
  // photoUrl is like "/uploads/photos/{userId}/{filename}"
  const relativePath = photoUrl.replace(/^\//, '');
  return path.join(UPLOAD_ROOT, relativePath);
}
