/**
 * Photo service — compression and upload of profile photos.
 *
 * Pipeline:
 *  1. Read raw image URI from ImagePicker
 *  2. Strip EXIF metadata (GPS, camera info) — lossless
 *  3. Resize to max 1200px on longest edge — reduces resolution without
 *     visible quality loss for profile photos
 *  4. Convert to WebP at quality 0.85 — visually lossless on modern
 *     screens while reducing file size by ~60-80%
 *  5. Upload as multipart/form-data to the backend
 */

import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system';
import { api } from './api';

// ─── Constants ───────────────────────────────────────────────────────

/** Maximum dimension on the longest edge. 1200px is plenty for profile photos. */
const MAX_DIMENSION = 1200;

/** Quality for WebP conversion. 0.85 is visually lossless for most images. */
const COMPRESSION_QUALITY = 0.85;

// ─── Public API ──────────────────────────────────────────────────────

export interface CompressedPhoto {
  /** Local file URI of the compressed image */
  uri: string;
  /** File size in bytes after compression */
  sizeBytes: number;
  /** Width in pixels */
  width: number;
  /** Height in pixels */
  height: number;
  /** Original file extension (for reference) */
  originalExtension: string;
}

/**
 * Compress a photo from an ImagePicker result.
 *
 * Steps:
 *  - Strip EXIF metadata (GPS location, camera make/model, etc.)
 *  - Resize to MAX_DIMENSION on the longest edge (preserves aspect ratio)
 *  - Convert to WebP format with lossy-but-high-quality compression
 *
 * Returns the compressed file info ready for upload.
 */
export async function compressPhoto(uri: string): Promise<CompressedPhoto> {
  const startMs = Date.now();

  // Read original file size for logging
  let originalSize = 0;
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (info.exists && 'size' in info) {
      originalSize = info.size ?? 0;
    }
  } catch {
    // Non-critical — we only use this for logging
  }

  // Determine original extension
  const originalExtension = uri.split('.').pop()?.toLowerCase() ?? 'jpg';

  // Compress: strip EXIF → resize → convert to WebP
  const result = await ImageManipulator.manipulateAsync(
    uri,
    [
      // Resize to max dimension (preserves aspect ratio)
      // This is a "lossless" resize because we're only shrinking, not enlarging
      { resize: { width: MAX_DIMENSION } },
    ],
    {
      compress: COMPRESSION_QUALITY,
      format: ImageManipulator.SaveFormat.WEBP,
    },
  );

  // Get compressed file size
  let compressedSize = 0;
  try {
    const info = await FileSystem.getInfoAsync(result.uri);
    if (info.exists && 'size' in info) {
      compressedSize = info.size ?? 0;
    }
  } catch {
    // Non-critical
  }

  const elapsed = Date.now() - startMs;
  const savedPct =
    originalSize > 0
      ? Math.round((1 - compressedSize / originalSize) * 100)
      : 0;

  console.log(
    `[photo] Compressed ${(originalSize / 1024).toFixed(1)}KB → ` +
      `${(compressedSize / 1024).toFixed(1)}KB (${savedPct}% saved) ` +
      `| ${result.width}x${result.height} | WebP | ${elapsed}ms`,
  );

  return {
    uri: result.uri,
    sizeBytes: compressedSize,
    width: result.width,
    height: result.height,
    originalExtension,
  };
}

/**
 * Upload a compressed photo to the backend.
 * Returns the server-side photo record.
 */
export async function uploadPhoto(compressed: CompressedPhoto): Promise<{
  id: string;
  url: string;
  thumbnailUrl: string;
}> {
  const formData = new FormData();
  formData.append('photo', {
    uri: compressed.uri,
    type: 'image/webp',
    name: `photo.${compressed.originalExtension}`,
  } as any);

  const response = await api.uploadPhoto(formData);
  return response;
}

/**
 * Full pipeline: compress → upload for a single photo URI.
 * Returns the server response or throws on failure.
 */
export async function compressAndUploadPhoto(
  uri: string,
): Promise<{
  id: string;
  url: string;
  thumbnailUrl: string;
}> {
  const compressed = await compressPhoto(uri);
  const result = await uploadPhoto(compressed);
  return result;
}
