/**
 * Photo service — compression and upload of profile photos.
 *
 * Pipeline:
 *  1. Read raw image URI from ImagePicker
 *  2. Strip EXIF metadata (GPS, camera info)
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
import { API_URL } from '../config';
import { api } from './api';

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

// ─── Faces in profile photos ─────────────────────────────────────────
//
// Checked on the device (ML Kit) BEFORE anything is uploaded: a photo that
// fails never reaches the server or MinIO. The rules:
// - Onboarding photos: exactly one face. A refused photo stays in the grid,
//   marked, and Continue stays blocked until the user removes it.
// - Adding a photo on the Profile page: at least one face (group photos ok).
// - Setting a photo as primary: exactly one face, checked before the selfie.

/** Why a photo was refused. 'check_failed' = the detector itself failed. */
export type PhotoFaceProblem = 'no_face' | 'multiple_faces' | 'check_failed';

export const PHOTO_FACE_MESSAGES: Record<PhotoFaceProblem, { title: string; message: string }> = {
  no_face: { title: 'No face detected', message: 'Add a clear photo of your face.' },
  multiple_faces: { title: 'More than one face', message: 'Use a photo with only you in it.' },
  check_failed: { title: "Couldn't check this photo", message: 'Try again.' },
};

export class PhotoFaceError extends Error {
  constructor(public readonly problem: PhotoFaceProblem) {
    super(`${PHOTO_FACE_MESSAGES[problem].title}. ${PHOTO_FACE_MESSAGES[problem].message}`);
    this.name = 'PhotoFaceError';
  }
}

/** 'one' = exactly one face, 'any' = at least one */
export type FaceRule = 'one' | 'any';

/**
 * Throws PhotoFaceError unless the image at `uri` passes the face rule.
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
    throw new PhotoFaceError('check_failed');
  }
  if (count === 0) throw new PhotoFaceError('no_face');
  if (count > 1 && rule === 'one') throw new PhotoFaceError('multiple_faces');
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
      throw new PhotoFaceError('check_failed');
    }
    if (status < 200 || status >= 300) throw new PhotoFaceError('check_failed');
    await requireOneFace(localPath, rule);
  } finally {
    FileSystem.deleteAsync(localPath, { idempotent: true }).catch(() => {});
  }
}

/**
 * Full pipeline: compress, check faces by `rule`, then upload.
 * Throws PhotoFaceError (nothing uploaded) when the face check fails.
 */
export async function compressAndUploadPhoto(
  uri: string,
  rule: FaceRule = 'one',
): Promise<{ id: string; url: string; thumbnailUrl: string }> {
  const compressed = await compressPhoto(uri);
  try {
    await requireOneFace(compressed.uri, rule);
  } catch (err) {
    FileSystem.deleteAsync(compressed.uri, { idempotent: true }).catch(() => {});
    throw err;
  }
  return await uploadPhoto(compressed);
}
