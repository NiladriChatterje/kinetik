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
  const token = api.getToken();
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

/**
 * Full pipeline: compress to upload for a single photo URI.
 */
export async function compressAndUploadPhoto(
  uri: string,
): Promise<{ id: string; url: string; thumbnailUrl: string }> {
  const compressed = await compressPhoto(uri);
  return await uploadPhoto(compressed);
}
