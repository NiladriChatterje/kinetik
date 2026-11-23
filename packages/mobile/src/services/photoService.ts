/**
 * Photo service — compression and upload of profile photos.
 *
 * Pipeline:
 *  1. Read raw image URI from ImagePicker
 *  2. Strip EXIF metadata (GPS, camera info) — read first by photoOrigin.ts
 *  3. Resize to max 1200px on longest edge
 *  4. Convert to WebP at quality 0.85
 *  5. Upload via FileSystem.uploadAsync (native multipart)
 *
 * Upload uses expo-file-system's native networking APIs rather than
 * React Native's JS FormData, which avoids the "Unsupported FormDataPart
 * implementation" bug entirely. The backend receives a proper multipart
 * binary file, and MinIO stores the raw bytes as-is.
 */

import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import type { ImagePickerAsset } from 'expo-image-picker';
import { API_URL } from '../config';
import { api } from './api';
import { checkPhotoMetadata, PickedPhoto } from './photoOrigin';

export type { PickedPhoto } from './photoOrigin';

// ─── Constants ───────────────────────────────────────────────────────

/** Maximum dimension on the longest edge. 1200px is plenty for profile photos. */
const MAX_DIMENSION = 1200;

/** Quality for WebP conversion. 0.85 is visually lossless for most images. */
const COMPRESSION_QUALITY = 0.85;

/** Upload timeout in milliseconds */
const UPLOAD_TIMEOUT_MS = 60000;

// ─── Public API ──────────────────────────────────────────────────────

export interface CompressedPhoto {
  uri: string;
  sizeBytes: number;
  width: number;
  height: number;
  originalExtension: string;
}

/**
 * Compress a photo from an ImagePicker result.
 */
export async function compressPhoto(uri: string): Promise<CompressedPhoto> {
  const startMs = Date.now();

  let originalSize = 0;
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (info.exists && 'size' in info) {
      originalSize = info.size ?? 0;
    }
  } catch { /* non-critical */ }

  const originalExtension = uri.split('.').pop()?.toLowerCase() ?? 'jpg';

  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: MAX_DIMENSION } }],
    {
      compress: COMPRESSION_QUALITY,
      format: ImageManipulator.SaveFormat.WEBP,
    },
  );

  let compressedSize = 0;
  try {
    const info = await FileSystem.getInfoAsync(result.uri);
    if (info.exists && 'size' in info) {
      compressedSize = info.size ?? 0;
    }
  } catch { /* non-critical */ }

  const elapsed = Date.now() - startMs;
  const savedPct =
    originalSize > 0
      ? Math.round((1 - compressedSize / originalSize) * 100)
      : 0;

  console.log(
    `[photo] Compressed ${(originalSize / 1024).toFixed(1)}KB \u2192 ` +
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
 * Upload a compressed photo as multipart/form-data using native networking.
 *
 * Uses FileSystem.uploadAsync from expo-file-system/legacy, which sends
 * the file via the native platform's HTTP client (NSURLSession on iOS,
 * OkHttp on Android). This completely bypasses React Native's JS FormData
 * implementation, avoiding the "Unsupported FormDataPart implementation" bug.
 *
 * The backend receives a standard multipart file upload, and MinIO stores
 * the raw binary bytes. No base64 encoding in transport.
 */
export async function uploadPhoto(compressed: CompressedPhoto): Promise<{
  id: string;
  url: string;
  thumbnailUrl: string;
}> {
  const token = await api.getFreshToken();
  const url = `${API_URL}/api/v1/users/photos`;

  // Race the native upload against a timeout (the legacy API doesn't support AbortSignal)
  const result = await Promise.race([
    FileSystem.uploadAsync(url, compressed.uri, {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      fieldName: 'photo',
      mimeType: 'image/webp',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Upload timed out. Please try again.')), UPLOAD_TIMEOUT_MS),
    ),
  ]);

  if (result.status >= 200 && result.status < 300) {
    const body = JSON.parse(result.body);
    return body.data;
  }

  let errorMessage = `Upload failed (HTTP ${result.status})`;
  try {
    const body = JSON.parse(result.body);
    errorMessage = body?.error?.message || errorMessage;
    if (__DEV__) {
      console.error('[photo] Server error response:', JSON.stringify(body, null, 2));
    }
  } catch {
    // Body is not JSON — log a snippet for debugging
    const snippet = result.body?.substring(0, 200);
    if (__DEV__) {
      console.error('[photo] Non-JSON response:', snippet);
    }
  }
  throw new Error(errorMessage);
}

// ─── Checks on profile photos ────────────────────────────────────────
//
// All on the device, BEFORE anything is uploaded: a photo that fails never
// reaches the server or MinIO.
// 1. Origin (photoOrigin.ts): screenshots and AI-generated images are
//    refused, from the original file's metadata, name and shape.
// 2. Faces (ML Kit):
//    - Onboarding photos: exactly one face. A refused photo stays in the
//      grid, marked, and Continue stays blocked until the user removes it.
//    - Adding a photo on the Profile page: at least one face (group photos ok).
//    - Setting a photo as primary: exactly one face, checked before the selfie.
// 3. AI-image model (aiImageDetector.ts), only for photos with no camera data
//    and no metadata verdict.

/** Why a photo was refused. 'check_failed' = the face detector itself failed. */
export type PhotoProblem = 'no_face' | 'multiple_faces' | 'screenshot' | 'ai_generated' | 'check_failed';

export const PHOTO_CHECK_MESSAGES: Record<PhotoProblem, { title: string; message: string }> = {
  no_face: { title: 'No face detected', message: 'Add a clear photo of your face.' },
  multiple_faces: { title: 'More than one face', message: 'Use a photo with only you in it.' },
  screenshot: { title: 'Screenshots not allowed', message: 'Add an original photo of you, or take one with the camera.' },
  ai_generated: { title: 'AI-generated photo', message: 'Add a real photo of you, or take one with the camera.' },
  check_failed: { title: "Couldn't check this photo", message: 'Try again.' },
};

export class PhotoCheckError extends Error {
  constructor(public readonly problem: PhotoProblem) {
    super(`${PHOTO_CHECK_MESSAGES[problem].title}. ${PHOTO_CHECK_MESSAGES[problem].message}`);
    this.name = 'PhotoCheckError';
  }
}

/** 'one' = exactly one face, 'any' = at least one */
export type FaceRule = 'one' | 'any';

/**
 * Throws PhotoCheckError unless the image at `uri` passes the face rule.
 * Faces only: new photos go through checkAndCompressPhoto, which runs this
 * plus the origin checks; photos already on the server use it directly.
 * Run it on the compressed WebP: the orientation is baked in and the
 * 1200px image is quicker to scan than the camera original.
 */
export async function requireOneFace(uri: string, rule: FaceRule = 'one'): Promise<void> {
  let count: number;
  try {
    // Lazy: ML Kit loads only when a photo is actually checked
    const { countFaces } = await import('./faceVerification');
    count = await countFaces(uri);
  } catch (err) {
    console.warn('[photo] Face check failed:', err);
    throw new PhotoCheckError('check_failed');
  }
  if (count === 0) throw new PhotoCheckError('no_face');
  if (count > 1 && rule === 'one') throw new PhotoCheckError('multiple_faces');
}

/**
 * The same check on a photo already on the server: downloaded to the cache,
 * scanned, deleted. A failed download is 'check_failed', never a pass.
 */
export async function requireFaceAtUrl(url: string, rule: FaceRule = 'one'): Promise<void> {
  const localPath = `${FileSystem.cacheDirectory}face-check-${Date.now()}-${Math.round(Math.random() * 1e6)}.webp`;
  try {
    let status = 0;
    try {
      // downloadAsync resolves on any HTTP status; an error page is no photo
      status = (await FileSystem.downloadAsync(url, localPath)).status;
    } catch {
      throw new PhotoCheckError('check_failed');
    }
    if (status < 200 || status >= 300) throw new PhotoCheckError('check_failed');
    await requireOneFace(localPath, rule);
  } finally {
    FileSystem.deleteAsync(localPath, { idempotent: true }).catch(() => {});
  }
}

/** The picker's result for one image, as the origin check needs it */
export function pickedFromAsset(asset: ImagePickerAsset, fromCamera = false): PickedPhoto {
  return {
    uri: asset.uri,
    fileName: asset.fileName,
    mimeType: asset.mimeType,
    width: asset.width,
    height: asset.height,
    exif: asset.exif,
    fromCamera,
  };
}

/**
 * Refuse a photo the AI-image model scores at or above the threshold.
 * A model failure lets the photo through: the metadata checks have run,
 * and an honest user must never be locked out by a broken model.
 */
async function requireNotAiImage(compressed: CompressedPhoto): Promise<void> {
  let score: number;
  try {
    const { aiImageScore } = await import('./aiImageDetector');
    score = await aiImageScore(compressed.uri, compressed.width, compressed.height);
  } catch (err) {
    console.warn('[photo] AI-image check failed, allowing the photo:', err);
    return;
  }
  if (__DEV__) console.log(`[photo] AI-image score ${score.toFixed(3)}`);
  const { AI_IMAGE_THRESHOLD } = await import('./aiImageDetector');
  if (score >= AI_IMAGE_THRESHOLD) throw new PhotoCheckError('ai_generated');
}

/**
 * Every check, in order: origin (screenshot / AI metadata) on the original
 * file, then compress, faces by `rule`, and the AI-image model when the
 * photo has no camera data. Resolves to the compressed photo, ready to
 * upload; throws PhotoCheckError (the compressed file deleted) otherwise.
 */
export async function checkAndCompressPhoto(
  picked: PickedPhoto,
  rule: FaceRule = 'one',
): Promise<CompressedPhoto> {
  const origin = checkPhotoMetadata(picked);
  if (origin === 'screenshot' || origin === 'ai_generated') throw new PhotoCheckError(origin);

  const compressed = await compressPhoto(picked.uri);
  try {
    await requireOneFace(compressed.uri, rule);
    if (origin === 'unsure') await requireNotAiImage(compressed);
  } catch (err) {
    FileSystem.deleteAsync(compressed.uri, { idempotent: true }).catch(() => {});
    throw err;
  }
  return compressed;
}

/**
 * Full pipeline: every check (checkAndCompressPhoto), then upload.
 * Throws PhotoCheckError (nothing uploaded) when a check fails.
 */
export async function compressAndUploadPhoto(
  picked: PickedPhoto,
  rule: FaceRule = 'one',
): Promise<{ id: string; url: string; thumbnailUrl: string }> {
  const compressed = await checkAndCompressPhoto(picked, rule);
  return await uploadPhoto(compressed);
}
