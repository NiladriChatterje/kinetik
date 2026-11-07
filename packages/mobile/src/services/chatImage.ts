/**
 * Chat photos: prepared on the phone before they are sent.
 *
 * The goal is a small file that still looks sharp, with nothing personal
 * attached.
 *
 *  1. Every photo is decoded (its rotation applied), scaled down to at most
 *     about 4.9 MP (2560 x 1920; sharper than any phone screen, with room to
 *     zoom) and saved as WebP: quality 80 for photos, 85 for PNGs
 *     (screenshots, graphics, text). Measured on real phone photos, a 12 MP
 *     camera shot of about 3 MB comes out at 100 to 200 KB, and 33 photos
 *     went from 44.6 MB to 4.7 MB, with only fine sensor grain smoothed. The
 *     encoder writes no metadata, so GPS position, camera details and
 *     anything stored after the image (motion-photo videos, depth maps) are
 *     gone.
 *  2. A JPEG or PNG that is already small (within the pixel target, and
 *     under 200 KB, or smaller than its WebP would be) is sent as it is,
 *     with only its metadata removed. That removal works on the file's bytes
 *     (utils/imageMetadata.ts) and never re-encodes the picture.
 *
 * The server strips once more and keeps the result as it is; it makes only
 * the small bubble thumbnail.
 *
 * Nothing is sent when a photo cannot be prepared: sending the untouched
 * original could leak where it was taken.
 */

import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import type { ImageRef } from 'expo-image-manipulator';
import { File, Paths } from 'expo-file-system';
import {
  ImageMetadataError,
  sniffImageFormat,
  stripJpegMetadata,
  stripPngMetadata,
  type StrippedImage,
} from '../utils/imageMetadata';

/** Under the server's 10 MB limit with room for the multipart envelope. */
export const CHAT_IMAGE_MAX_BYTES = 9 * 1024 * 1024;
/** What a photo is scaled down to: 2560 x 1920, about 4.9 MP. */
export const CHAT_IMAGE_TARGET_PIXELS = 2560 * 1920;
/** The most an original may have to go as it is when it cannot be decoded here (4096 x 4096). */
export const CHAT_IMAGE_MAX_PIXELS = 4096 * 4096;
/** A long screenshot may be tall, but not taller than this. */
export const CHAT_IMAGE_MAX_EDGE = 8192;
/** An original already this small (and within the pixel target) is not re-encoded. */
const KEEP_ORIGINAL_BYTES = 200 * 1024;

/** WebP quality for photos, and for PNGs, where sharp text matters more. */
const PHOTO_QUALITY = 0.8;
const GRAPHIC_QUALITY = 0.85;

/** Smaller tries if a picture is somehow still over the byte limit. */
const STEP_DOWN = [
  { scale: 1, quality: 1 },
  { scale: 0.8, quality: 0.95 },
  { scale: 0.64, quality: 0.9 },
] as const;

export interface PreparedChatImage {
  /** A file in the app's cache, made for this upload. Remove it with discardPreparedChatImage. */
  uri: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  width: number;
  height: number;
  sizeBytes: number;
  /** True when the picture itself is untouched (only metadata removed). */
  lossless: boolean;
}

export class ChatImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChatImageError';
  }
}

function cacheFile(ext: 'jpg' | 'png'): File {
  return new File(Paths.cache, `chat-photo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`);
}

function deleteQuietly(uri: string): void {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch { /* cache, cleared by the system */ }
}

/** The largest scale (at most 1) that brings a picture within `pixels` and the edge limit. */
function scaleToFit(width: number, height: number, pixels: number): number {
  return Math.min(1, Math.sqrt(pixels / (width * height)), CHAT_IMAGE_MAX_EDGE / Math.max(width, height));
}

function withinTarget(image: StrippedImage): boolean {
  return scaleToFit(image.width, image.height, CHAT_IMAGE_TARGET_PIXELS) === 1;
}

/** The original's bytes with only the metadata removed; null when it is not a JPEG or PNG this can read. */
function stripOriginal(original: Uint8Array): { image: StrippedImage; format: 'jpeg' | 'png' } | null {
  const format = sniffImageFormat(original);
  if (format === 'other') return null;
  try {
    return { image: format === 'jpeg' ? stripJpegMetadata(original) : stripPngMetadata(original), format };
  } catch (err) {
    if (err instanceof ImageMetadataError) {
      console.warn(`[ChatImage] ${format} metadata not removable as-is (${err.message})`);
      return null;
    }
    throw err;
  }
}

function saveStripped(stripped: { image: StrippedImage; format: 'jpeg' | 'png' }): PreparedChatImage {
  const out = cacheFile(stripped.format === 'jpeg' ? 'jpg' : 'png');
  out.write(stripped.image.bytes);
  return {
    uri: out.uri,
    mimeType: stripped.format === 'jpeg' ? 'image/jpeg' : 'image/png',
    width: stripped.image.width,
    height: stripped.image.height,
    sizeBytes: stripped.image.bytes.length,
    lossless: true,
  };
}

/** Upright, at most the pixel target, WebP, no metadata. */
async function compress(uri: string, quality: number): Promise<PreparedChatImage> {
  // The decoder applies the EXIF rotation, so width/height are as seen
  const context = ImageManipulator.manipulate(uri);
  let decoded: ImageRef;
  try {
    decoded = await context.renderAsync();
  } finally {
    context.release();
  }
  try {
    const fit = scaleToFit(decoded.width, decoded.height, CHAT_IMAGE_TARGET_PIXELS);
    for (const step of STEP_DOWN) {
      const scale = fit * step.scale;
      let image = decoded;
      if (scale < 1) {
        const resize = ImageManipulator.manipulate(decoded)
          .resize({ width: Math.max(1, Math.round(decoded.width * scale)) });
        try {
          image = await resize.renderAsync();
        } finally {
          resize.release();
        }
      }
      try {
        const saved = await image.saveAsync({ compress: quality * step.quality, format: SaveFormat.WEBP });
        const size = new File(saved.uri).size;
        if (size > 0 && size <= CHAT_IMAGE_MAX_BYTES) {
          return {
            uri: saved.uri,
            mimeType: 'image/webp',
            width: saved.width,
            height: saved.height,
            sizeBytes: size,
            lossless: false,
          };
        }
        deleteQuietly(saved.uri);
      } finally {
        if (image !== decoded) image.release();
      }
    }
  } finally {
    decoded.release();
  }
  throw new ChatImageError('This photo is too large to send.');
}

/**
 * Make a picked or taken photo ready to send. Throws ChatImageError (with a
 * message for the user) when it cannot be prepared; never returns the
 * untouched original.
 */
export async function prepareChatImage(uri: string): Promise<PreparedChatImage> {
  const startMs = Date.now();
  let original: Uint8Array;
  try {
    original = await new File(uri).bytes();
  } catch {
    throw new ChatImageError('Could not read this photo. Please pick it again.');
  }

  let prepared: PreparedChatImage;
  try {
    const stripped = stripOriginal(original);
    const smallEnough = !!stripped && withinTarget(stripped.image);

    if (stripped && smallEnough && stripped.image.bytes.length <= KEEP_ORIGINAL_BYTES) {
      // Already lean: nothing to gain from a re-encode
      prepared = saveStripped(stripped);
    } else {
      let compressed: PreparedChatImage | null = null;
      try {
        compressed = await compress(uri, stripped?.format === 'png' ? GRAPHIC_QUALITY : PHOTO_QUALITY);
      } catch (err) {
        // Could not decode or shrink it here: the stripped original may still go
        const fallback =
          stripped &&
          stripped.image.bytes.length <= CHAT_IMAGE_MAX_BYTES &&
          stripped.image.width * stripped.image.height <= CHAT_IMAGE_MAX_PIXELS &&
          Math.max(stripped.image.width, stripped.image.height) <= CHAT_IMAGE_MAX_EDGE;
        if (!fallback) throw err;
        console.warn('[ChatImage] Could not compress; sending the original with metadata removed:', err);
      }

      if (!compressed) {
        prepared = saveStripped(stripped!);
      } else if (stripped && smallEnough && stripped.image.bytes.length <= compressed.sizeBytes) {
        // The original is no bigger than its WebP: keep every pixel instead
        deleteQuietly(compressed.uri);
        prepared = saveStripped(stripped);
      } else {
        prepared = compressed;
      }
    }
  } catch (err) {
    if (err instanceof ChatImageError) throw err;
    console.warn('[ChatImage] Could not prepare photo:', err);
    throw new ChatImageError('Could not prepare this photo. Please try another one.');
  }

  console.log(
    `[ChatImage] ${(original.length / 1024).toFixed(0)}KB -> ${(prepared.sizeBytes / 1024).toFixed(0)}KB ` +
      `| ${prepared.width}x${prepared.height} ${prepared.mimeType} ` +
      `| ${prepared.lossless ? 'metadata stripped, pixels untouched' : 'compressed'} | ${Date.now() - startMs}ms`,
  );
  return prepared;
}

/** Remove the prepared file once it is uploaded (or the send failed). */
export function discardPreparedChatImage(prepared: PreparedChatImage | null): void {
  if (prepared) deleteQuietly(prepared.uri);
}
