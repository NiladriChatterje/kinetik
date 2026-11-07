/**
 * Chat photos: prepared on the phone before they are sent.
 *
 * The goal is the original quality with nothing personal attached.
 *
 *  1. JPEG (camera photos) and PNG (screenshots) are sent as they are, with
 *     only their metadata removed. That removal works on the file's bytes
 *     (utils/imageMetadata.ts) and never re-encodes the picture, so it is
 *     lossless: GPS position, camera details, comments and anything stored
 *     after the image (motion-photo videos, depth maps) go; every pixel stays.
 *  2. Only a photo too big to send that way (over 16.8 MP, an edge over
 *     8192 px, or more than 9 MB after the strip), or one in another format
 *     (HEIC, WebP, GIF), is re-encoded: scaled to fit those limits if needed
 *     and saved as a high-quality JPEG (92). The re-encode applies the
 *     photo's rotation and writes no metadata.
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
/** 4096 x 4096. A 12 MP camera photo (4000 x 3000) goes untouched. */
export const CHAT_IMAGE_MAX_PIXELS = 4096 * 4096;
/** A long screenshot may be tall, but not taller than this. */
export const CHAT_IMAGE_MAX_EDGE = 8192;

/** Re-encode quality, then two smaller tries if a photo is still over the byte limit. */
const REENCODE_STEPS = [
  { scale: 1, quality: 0.92 },
  { scale: 0.8, quality: 0.9 },
  { scale: 0.64, quality: 0.88 },
] as const;

export interface PreparedChatImage {
  /** A file in the app's cache, made for this upload. Remove it with discardPreparedChatImage. */
  uri: string;
  mimeType: 'image/jpeg' | 'image/png';
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

function fitsAsIs(image: StrippedImage): boolean {
  return (
    image.bytes.length <= CHAT_IMAGE_MAX_BYTES &&
    image.width * image.height <= CHAT_IMAGE_MAX_PIXELS &&
    Math.max(image.width, image.height) <= CHAT_IMAGE_MAX_EDGE
  );
}

function cacheFile(ext: 'jpg' | 'png'): File {
  return new File(Paths.cache, `chat-photo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`);
}

/** The largest scale (at most 1) that brings a picture within the pixel and edge limits. */
function scaleToFit(width: number, height: number): number {
  return Math.min(
    1,
    Math.sqrt(CHAT_IMAGE_MAX_PIXELS / (width * height)),
    CHAT_IMAGE_MAX_EDGE / Math.max(width, height),
  );
}

/** Lossless path. Null when the photo needs a re-encode instead. */
async function stripAsIs(original: Uint8Array): Promise<PreparedChatImage | null> {
  const format = sniffImageFormat(original);
  if (format === 'other') return null;

  let stripped: StrippedImage;
  try {
    stripped = format === 'jpeg' ? stripJpegMetadata(original) : stripPngMetadata(original);
  } catch (err) {
    if (err instanceof ImageMetadataError) {
      console.warn(`[ChatImage] ${format} not stripped as-is (${err.message}); re-encoding`);
      return null;
    }
    throw err;
  }
  if (!fitsAsIs(stripped)) return null;

  const out = cacheFile(format === 'jpeg' ? 'jpg' : 'png');
  out.write(stripped.bytes);
  return {
    uri: out.uri,
    mimeType: format === 'jpeg' ? 'image/jpeg' : 'image/png',
    width: stripped.width,
    height: stripped.height,
    sizeBytes: stripped.bytes.length,
    lossless: true,
  };
}

/** Re-encode path: upright, within the limits, JPEG 92, no metadata. */
async function reencode(uri: string): Promise<PreparedChatImage> {
  // The decoder applies the EXIF rotation, so width/height are as seen
  const context = ImageManipulator.manipulate(uri);
  let decoded: ImageRef;
  try {
    decoded = await context.renderAsync();
  } finally {
    context.release();
  }
  try {
    const fit = scaleToFit(decoded.width, decoded.height);
    for (const step of REENCODE_STEPS) {
      const scale = fit * step.scale;
      let image = decoded;
      if (scale < 1) {
        const resize = ImageManipulator.manipulate(decoded)
          .resize({ width: Math.max(1, Math.floor(decoded.width * scale)) });
        try {
          image = await resize.renderAsync();
        } finally {
          resize.release();
        }
      }
      try {
        const saved = await image.saveAsync({ compress: step.quality, format: SaveFormat.JPEG });
        const file = new File(saved.uri);
        const size = file.size;
        if (size > 0 && size <= CHAT_IMAGE_MAX_BYTES) {
          return {
            uri: saved.uri,
            mimeType: 'image/jpeg',
            width: saved.width,
            height: saved.height,
            sizeBytes: size,
            lossless: false,
          };
        }
        try {
          file.delete();
        } catch { /* cache, cleared by the system */ }
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

  let prepared: PreparedChatImage | null = null;
  try {
    prepared = (await stripAsIs(original)) ?? (await reencode(uri));
  } catch (err) {
    if (err instanceof ChatImageError) throw err;
    console.warn('[ChatImage] Could not prepare photo:', err);
    throw new ChatImageError('Could not prepare this photo. Please try another one.');
  }

  console.log(
    `[ChatImage] ${(original.length / 1024).toFixed(0)}KB -> ${(prepared.sizeBytes / 1024).toFixed(0)}KB ` +
      `| ${prepared.width}x${prepared.height} ${prepared.mimeType} ` +
      `| ${prepared.lossless ? 'metadata stripped, pixels untouched' : 're-encoded'} | ${Date.now() - startMs}ms`,
  );
  return prepared;
}

/** Remove the prepared file once it is uploaded (or the send failed). */
export function discardPreparedChatImage(prepared: PreparedChatImage | null): void {
  if (!prepared) return;
  try {
    const file = new File(prepared.uri);
    if (file.exists) file.delete();
  } catch { /* cache, cleared by the system */ }
}
