/**
 * Photo origin check — is a picked profile photo a screenshot or an
 * AI-generated image? Runs on the device, on the ORIGINAL file the picker
 * returned (quality 1.0 = a byte-for-byte copy with its metadata), before
 * anything is compressed or uploaded. A refused photo never reaches MinIO.
 *
 * Signals, strongest first:
 *  1. AI tags written by the generator into the file: IPTC/C2PA digital
 *     source type "trainedAlgorithmicMedia" (ChatGPT/DALL·E, Meta AI,
 *     Gemini, Firefly…), Stable Diffusion / ComfyUI / NovelAI / Midjourney
 *     text chunks and EXIF Software names.
 *  2. Screenshot marks: a "Screenshot_…" file name, EXIF "Screenshot" comment.
 *  3. Camera data (make/model + exposure, f-number or ISO). A photo with it
 *     is a genuine camera photo: allowed, no further checks.
 *  4. Without camera data: a PNG, a phone-screen shape (18:9 and taller)
 *     or this phone's exact screen size is a screenshot; anything else is
 *     'unsure' and the on-device AI-image model (aiImageDetector.ts) judges
 *     the pixels.
 *
 * A photo taken with the in-app camera is trusted as is.
 *
 * Edited AI touch-ups of a real photo (Magic Eraser, generative fill) carry
 * "compositeWithTrainedAlgorithmicMedia" and are NOT refused: the person in
 * them is real.
 */

import { Dimensions, PixelRatio } from 'react-native';
import { File } from 'expo-file-system';

export type PhotoOriginProblem = 'screenshot' | 'ai_generated';

/** What the picker told us about the chosen file */
export interface PickedPhoto {
  uri: string;
  fileName?: string | null;
  mimeType?: string | null;
  width?: number;
  height?: number;
  /** The picker's EXIF (exif: true), used alongside our own parse */
  exif?: Record<string, unknown> | null;
  /** Taken with the in-app camera just now */
  fromCamera?: boolean;
}

// ─── Byte access ─────────────────────────────────────────────────────

/** Random access to a file's bytes (a FileHandle on the phone, a Buffer in tests) */
export interface ByteSource {
  size: number;
  read(offset: number, length: number): Uint8Array;
}

/** Most metadata we will collect from one file (C2PA manifests can be large) */
const MAX_METADATA_BYTES = 4 * 1024 * 1024;
/** Unknown formats (HEIC, AVIF…): scan this much of the head for markers */
const HEAD_SCAN_BYTES = 1024 * 1024;

export type ImageFormat = 'jpeg' | 'png' | 'webp' | 'heif' | 'gif' | 'other';

export interface Metadata {
  format: ImageFormat;
  /** Make/Model present */
  hasMakeModel: boolean;
  /** ExposureTime / FNumber / ISO / FocalLength present (and non-zero) */
  hasExposure: boolean;
  /** EXIF text fields worth reading: Software, UserComment, ImageDescription… */
  exifText: string[];
  /** Every metadata block (EXIF, XMP, IPTC, C2PA, PNG text) as latin-1 text */
  text: string;
}

const latin1 = (b: Uint8Array, start = 0, end = b.length): string => {
  let s = '';
  // Chunked: String.fromCharCode with a huge spread blows the stack
  for (let i = start; i < end; i += 8192) {
    s += String.fromCharCode.apply(null, Array.from(b.subarray(i, Math.min(end, i + 8192))));
  }
  return s;
};

function detectFormat(head: Uint8Array): ImageFormat {
  if (head[0] === 0xff && head[1] === 0xd8) return 'jpeg';
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return 'png';
  const s = latin1(head, 0, Math.min(head.length, 16));
  if (s.startsWith('RIFF') && s.slice(8, 12) === 'WEBP') return 'webp';
  if (s.slice(4, 8) === 'ftyp') return 'heif';
  if (s.startsWith('GIF8')) return 'gif';
  return 'other';
}

// ─── EXIF (TIFF) ─────────────────────────────────────────────────────

const TAG_MAKE = 0x010f;
const TAG_MODEL = 0x0110;
const TAG_SOFTWARE = 0x0131;
const TAG_IMAGE_DESCRIPTION = 0x010e;
const TAG_ARTIST = 0x013b;
const TAG_EXIF_IFD = 0x8769;
const TAG_EXPOSURE_TIME = 0x829a;
const TAG_F_NUMBER = 0x829d;
const TAG_ISO = 0x8827;
const TAG_FOCAL_LENGTH = 0x920a;
const TAG_USER_COMMENT = 0x9286;

const TEXT_TAGS = new Set([TAG_MAKE, TAG_MODEL, TAG_SOFTWARE, TAG_IMAGE_DESCRIPTION, TAG_ARTIST, TAG_USER_COMMENT]);
const EXPOSURE_TAGS = new Set([TAG_EXPOSURE_TIME, TAG_F_NUMBER, TAG_ISO, TAG_FOCAL_LENGTH]);
const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

/** Parse a TIFF block (the body of an EXIF segment / eXIf chunk) into `meta` */
export function parseTiff(t: Uint8Array, meta: Metadata): void {
  if (t.length < 8) return;
  const le = t[0] === 0x49 && t[1] === 0x49;
  if (!le && !(t[0] === 0x4d && t[1] === 0x4d)) return;
  const u16 = (o: number) => (o + 2 > t.length ? 0 : le ? t[o] | (t[o + 1] << 8) : (t[o] << 8) | t[o + 1]);
  const u32 = (o: number) =>
    o + 4 > t.length ? 0 : le
      ? (t[o] | (t[o + 1] << 8) | (t[o + 2] << 16) | (t[o + 3] << 24)) >>> 0
      : ((t[o] << 24) | (t[o + 1] << 16) | (t[o + 2] << 8) | t[o + 3]) >>> 0;

  const seen = new Set<number>();
  const readIfd = (ifd: number, depth: number) => {
    if (depth > 2 || ifd < 8 || ifd + 2 > t.length || seen.has(ifd)) return;
    seen.add(ifd);
    const n = Math.min(u16(ifd), 512);
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      if (e + 12 > t.length) return;
      const tag = u16(e);
      const type = u16(e + 2);
      const count = u32(e + 4);
      const bytes = (TYPE_SIZE[type] ?? 1) * count;
      const at = bytes <= 4 ? e + 8 : u32(e + 8);
      if (tag === TAG_EXIF_IFD) {
        readIfd(u32(e + 8), depth + 1);
        continue;
      }
      if (at + Math.min(bytes, 1) > t.length) continue;
      const value = t.subarray(at, Math.min(t.length, at + Math.min(bytes, 4096)));
      if (tag === TAG_MAKE || tag === TAG_MODEL) {
        if (latin1(value).replace(/[\0\s]/g, '').length > 0) meta.hasMakeModel = true;
      }
      if (EXPOSURE_TAGS.has(tag) && value.some((v) => v !== 0)) meta.hasExposure = true;
      if (TEXT_TAGS.has(tag)) {
        // UserComment starts with an 8-byte charset id (ASCII\0\0\0, UNICODE\0…)
        const body = tag === TAG_USER_COMMENT ? value.subarray(8) : value;
        const s = latin1(body).replace(/\0/g, '').trim();
        if (s) meta.exifText.push(s);
      }
    }
  };
  readIfd(u32(4), 0);
}

// ─── Container walkers ───────────────────────────────────────────────

/** Collect the metadata of a file without reading its image data */
export function readMetadata(src: ByteSource): Metadata {
  const head = src.read(0, Math.min(src.size, 32));
  const meta: Metadata = { format: detectFormat(head), hasMakeModel: false, hasExposure: false, exifText: [], text: '' };
  const parts: string[] = [];
  let budget = MAX_METADATA_BYTES;
  const take = (offset: number, length: number): Uint8Array => {
    const n = Math.max(0, Math.min(length, budget, src.size - offset));
    budget -= n;
    return n > 0 ? src.read(offset, n) : new Uint8Array(0);
  };

  if (meta.format === 'jpeg') {
    let pos = 2;
    for (let guard = 0; guard < 1000 && pos + 4 <= src.size; guard++) {
      const m = src.read(pos, 4);
      if (m[0] !== 0xff) break;
      const marker = m[1];
      if (marker === 0xff) { pos += 1; continue; } // fill byte
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { pos += 2; continue; }
      if (marker === 0xda || marker === 0xd9) break; // image data starts: metadata is over
      const len = (m[2] << 8) | m[3];
      if (len < 2) break;
      // APP1 (EXIF, XMP), APP11 (C2PA JUMBF), APP13 (IPTC), COM
      if (marker === 0xe1 || marker === 0xeb || marker === 0xed || marker === 0xfe) {
        const body = take(pos + 4, len - 2);
        if (marker === 0xe1 && latin1(body, 0, 6) === 'Exif\0\0') parseTiff(body.subarray(6), meta);
        parts.push(latin1(body));
      }
      pos += 2 + len;
    }
  } else if (meta.format === 'png') {
    let pos = 8;
    for (let guard = 0; guard < 10000 && pos + 8 <= src.size; guard++) {
      const h = src.read(pos, 8);
      const len = ((h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]) >>> 0;
      const type = latin1(h, 4, 8);
      if (type === 'IEND') break;
      if (type === 'tEXt' || type === 'iTXt' || type === 'zTXt' || type === 'eXIf' || type === 'caBX') {
        const body = take(pos + 8, type === 'zTXt' ? Math.min(len, 80) : len); // zTXt: keyword only
        if (type === 'eXIf') parseTiff(body, meta);
        parts.push(latin1(body));
      }
      pos += 12 + len;
    }
  } else if (meta.format === 'webp') {
    let pos = 12;
    for (let guard = 0; guard < 1000 && pos + 8 <= src.size; guard++) {
      const h = src.read(pos, 8);
      const type = latin1(h, 0, 4);
      const len = (h[4] | (h[5] << 8) | (h[6] << 16) | (h[7] << 24)) >>> 0;
      if (type === 'EXIF' || type === 'XMP ' || type === 'C2PA') {
        const body = take(pos + 8, len);
        const tiff = latin1(body, 0, 6) === 'Exif\0\0' ? body.subarray(6) : body;
        if (type === 'EXIF') parseTiff(tiff, meta);
        parts.push(latin1(body));
      }
      pos += 8 + len + (len & 1);
    }
  } else {
    // HEIC/AVIF/other: no box walk; scan the head for the same text markers.
    // Camera data for HEIC comes from the picker's EXIF instead.
    parts.push(latin1(take(0, Math.min(src.size, HEAD_SCAN_BYTES))));
  }

  meta.text = parts.join('\n');
  return meta;
}

// ─── Judging ─────────────────────────────────────────────────────────

/** Names generators write into Software / PNG text / C2PA claim generators */
const AI_NAMES = [
  'midjourney', 'stable diffusion', 'stable-diffusion', 'stablediffusion', 'novelai', 'comfyui',
  'invokeai', 'automatic1111', 'openai', 'chatgpt', 'dall-e', 'leonardo.ai',
  'ideogram', 'bing image creator', 'image creator from designer', 'nightcafe', 'dreamstudio',
];

/** True when the metadata says the image was generated by AI */
export function hasAiMarkers(meta: Metadata): boolean {
  const all = (meta.text + '\n' + meta.exifText.join('\n')).toLowerCase();
  // AI touch-ups of a real photo say "compositeWithTrainedAlgorithmicMedia":
  // drop those first so only fully generated images match below
  const text = all.split('compositewithtrainedalgorithmicmedia').join('');
  if (text.includes('trainedalgorithmicmedia')) return true;
  if (text.includes('digitalsourcetype/algorithmicmedia')) return true;
  // Stable Diffusion WebUI "parameters" text, ComfyUI workflow JSON
  if (text.includes('steps:') && text.includes('sampler:')) return true;
  if (text.includes('"class_type"') || text.includes('ksampler')) return true;
  return AI_NAMES.some((n) => text.includes(n));
}

const SCREENSHOT_NAME = /screen[\s_-]?shot|screencap|screen[\s_-]?capture|scrnli|^scr_\d/i;

/** True when the file name or EXIF says screenshot */
export function hasScreenshotMarkers(meta: Metadata, fileName?: string | null): boolean {
  if (fileName && SCREENSHOT_NAME.test(fileName)) return true;
  return meta.exifText.some((s) => /screenshot|screen shot|screencap/i.test(s));
}

/** The picker's EXIF has camera data (covers HEIC, which we do not walk) */
function pickerExifIsCamera(exif?: Record<string, unknown> | null): boolean {
  if (!exif) return false;
  const present = (k: string) => {
    const v = exif[k];
    if (v === undefined || v === null || v === '') return false;
    return typeof v === 'number' ? v > 0 : String(v).replace(/[\0\s0.]/g, '').length > 0;
  };
  const makeModel = present('Make') || present('Model');
  const exposure = present('ExposureTime') || present('FNumber') || present('ISOSpeedRatings')
    || present('PhotographicSensitivity') || present('FocalLength');
  return makeModel && exposure;
}

/** Phone screens are 18:9 and taller; camera photos are 4:3, 3:2, 16:9 or 1:1 */
const SCREEN_SHAPE_MIN_RATIO = 1.9;

function looksLikeScreenShape(width?: number, height?: number): boolean {
  if (!width || !height) return false;
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  if (long / short >= SCREEN_SHAPE_MIN_RATIO) return true;
  // This phone's own screen, either way round
  const screen = Dimensions.get('screen');
  const sw = Math.round(PixelRatio.getPixelSizeForLayoutSize(Math.min(screen.width, screen.height)));
  const sh = Math.round(PixelRatio.getPixelSizeForLayoutSize(Math.max(screen.width, screen.height)));
  return Math.abs(short - sw) <= 2 && Math.abs(long - sh) <= 2;
}

/** Decision from metadata alone. 'unsure' = no camera data, nothing found: ask the model. */
export function judgeMetadata(
  meta: Metadata,
  photo: PickedPhoto,
): PhotoOriginProblem | 'camera' | 'unsure' {
  if (hasAiMarkers(meta)) return 'ai_generated';
  if (hasScreenshotMarkers(meta, photo.fileName)) return 'screenshot';
  if ((meta.hasMakeModel && meta.hasExposure) || pickerExifIsCamera(photo.exif)) return 'camera';
  // No camera data from here on
  if (meta.format === 'png' || (photo.mimeType ?? '').toLowerCase() === 'image/png') return 'screenshot';
  if (looksLikeScreenShape(photo.width, photo.height)) return 'screenshot';
  return 'unsure';
}

/** A FileHandle as a ByteSource */
function openSource(uri: string): { src: ByteSource; close: () => void } {
  const handle = new File(uri).open();
  const size = handle.size ?? 0;
  return {
    src: {
      size,
      read(offset, length) {
        handle.offset = offset;
        return handle.readBytes(length);
      },
    },
    close: () => handle.close(),
  };
}

/**
 * Check a picked photo's file and metadata. Resolves to:
 * - 'screenshot' / 'ai_generated': refuse it, nothing is uploaded;
 * - 'camera': a genuine camera photo (or the in-app camera): allowed;
 * - 'unsure': no camera data and nothing found; the AI-image model decides
 *   (photoService.ts runs it on the compressed photo).
 * Never throws: an unreadable file is judged by its name and shape alone,
 * so a picker quirk can't lock an honest user out.
 */
export function checkPhotoMetadata(photo: PickedPhoto): PhotoOriginProblem | 'camera' | 'unsure' {
  if (photo.fromCamera) return 'camera';

  let meta: Metadata;
  try {
    const { src, close } = openSource(photo.uri);
    try {
      meta = readMetadata(src);
    } finally {
      close();
    }
  } catch (err) {
    console.warn('[photo-origin] Could not read metadata:', err);
    meta = { format: 'other', hasMakeModel: false, hasExposure: false, exifText: [], text: '' };
  }

  const verdict = judgeMetadata(meta, photo);
  if (__DEV__) {
    console.log(
      `[photo-origin] ${photo.fileName ?? '?'} ${meta.format} ${photo.width}x${photo.height}`
        + ` camera=${meta.hasMakeModel && meta.hasExposure} -> ${verdict}`,
    );
  }
  return verdict;
}
