/**
 * Lossless metadata removal for chat photos.
 *
 * Works on the encoded bytes only: pixels are never decoded or re-encoded,
 * so the picture that comes out is bit for bit the picture that went in.
 *
 * Removed: EXIF (GPS position, date, camera model, serial numbers, the
 * embedded preview), XMP, IPTC / Photoshop blocks, comments, maker notes,
 * PNG text chunks, and everything stored after the image itself (motion
 * photo videos, depth maps, HDR gain maps, vendor trailers).
 *
 * Kept: what is needed to draw the same picture. The image data, its colour
 * profile (ICC), the JFIF and Adobe colour headers and, for a JPEG, the
 * orientation, rewritten as a minimal EXIF block that holds only that one
 * tag, so a photo taken upright still shows upright.
 *
 * Anything this cannot read with certainty throws ImageMetadataError. The
 * caller then falls back to a re-encode, which also drops all metadata.
 *
 * Two identical copies: packages/mobile/src/utils/imageMetadata.ts (the phone
 * strips before upload) and packages/api-core/src/services/imageMetadata.ts
 * (the server strips again, so no client can store a located photo).
 * imageMetadata.test.ts keeps them identical. No platform imports here.
 */

export class ImageMetadataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageMetadataError';
  }
}

export type SniffedFormat = 'jpeg' | 'png' | 'other';

export interface StrippedImage {
  /** A new array (offset 0) holding the cleaned file. */
  bytes: Uint8Array;
  width: number;
  height: number;
  /** EXIF orientation, 1 to 8. 1 = shown as stored. Kept in the output for a JPEG. */
  orientation: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Format from the first bytes. A file name or a stated MIME type can lie (the picker names a HEIC "x.jpeg"). */
export function sniffImageFormat(bytes: Uint8Array): SniffedFormat {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.length >= 8 && PNG_SIGNATURE.every((b, i) => bytes[i] === b)) return 'png';
  return 'other';
}

// ─── Shared helpers ──────────────────────────────────────────────────

function fail(message: string): never {
  throw new ImageMetadataError(message);
}

function hasPrefix(d: Uint8Array, at: number, end: number, prefix: number[]): boolean {
  if (at + prefix.length > end) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (d[at + i] !== prefix[i]) return false;
  }
  return true;
}

function ascii(text: string): number[] {
  return Array.from(text, (c) => c.charCodeAt(0));
}

function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/**
 * The Orientation tag (0x0112) of a TIFF/EXIF block d[start, end).
 * 1 when the tag is absent or holds a value outside 1 to 8 (viewers ignore
 * those). Throws when the block itself cannot be read, because a photo
 * whose orientation is unknown could come out sideways.
 */
export function readTiffOrientation(d: Uint8Array, start: number, end: number): number {
  if (end - start < 8) fail('EXIF block too short');
  let little: boolean;
  if (d[start] === 0x49 && d[start + 1] === 0x49) little = true;
  else if (d[start] === 0x4d && d[start + 1] === 0x4d) little = false;
  else fail('EXIF byte order unknown');

  const u16 = (o: number) => (little ? d[o] | (d[o + 1] << 8) : (d[o] << 8) | d[o + 1]);
  const u32 = (o: number) =>
    (little
      ? d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)
      : (d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]) >>> 0;

  if (u16(start + 2) !== 42) fail('EXIF header invalid');
  const ifd = start + u32(start + 4);
  if (ifd < start + 8 || ifd + 2 > end) fail('EXIF directory outside the block');
  const count = u16(ifd);
  if (ifd + 2 + count * 12 > end) fail('EXIF directory overruns the block');

  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (u16(entry) !== 0x0112) continue;
    // SHORT, at least one value; the value sits in the first two bytes of the field
    if (u16(entry + 2) !== 3 || u32(entry + 4) < 1) return 1;
    const value = u16(entry + 8);
    return value >= 1 && value <= 8 ? value : 1;
  }
  return 1;
}

// ─── JPEG ────────────────────────────────────────────────────────────

const JFIF = ascii('JFIF\0');
const EXIF = ascii('Exif\0');
const ICC_PROFILE = ascii('ICC_PROFILE\0');
const ADOBE = ascii('Adobe');

/** Start-of-frame markers, the ones that carry the picture size. */
function isStartOfFrame(code: number): boolean {
  return code >= 0xc0 && code <= 0xcf && code !== 0xc4 && code !== 0xc8 && code !== 0xcc;
}

/** An APP1 EXIF segment with one entry: Orientation. 36 bytes. */
function orientationSegment(orientation: number): Uint8Array {
  return Uint8Array.of(
    0xff, 0xe1, 0x00, 0x22, // APP1, length 34
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // "Exif\0\0"
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // big endian TIFF, first directory at 8
    0x00, 0x01, // one entry
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation, 0x00, 0x00, // Orientation, SHORT, 1
    0x00, 0x00, 0x00, 0x00, // no further directory
  );
}

/**
 * A JPEG with every metadata segment and any trailing data removed. The
 * compressed image data is copied unchanged.
 */
export function stripJpegMetadata(d: Uint8Array): StrippedImage {
  if (sniffImageFormat(d) !== 'jpeg') fail('not a JPEG');

  const kept: Uint8Array[] = [];
  let jfif: Uint8Array | null = null;
  let sawExif = false;
  let orientation = 1;
  let width = 0;
  let height = 0;
  let sawScan = false;
  let pos = 2;

  for (;;) {
    if (pos >= d.length) fail('JPEG ends before its end marker');
    if (d[pos] !== 0xff) fail('JPEG marker expected');
    // Any number of 0xFF fill bytes may precede a marker
    while (pos < d.length && d[pos] === 0xff) pos++;
    if (pos >= d.length) fail('JPEG ends inside a marker');
    const code = d[pos];
    const markerStart = pos - 1;
    pos++;

    if (code === 0xd9) {
      // End of image. Whatever follows (videos, gain maps, trailers) is dropped.
      if (!sawScan) fail('JPEG has no image data');
      kept.push(d.subarray(markerStart, pos));
      break;
    }
    if (code === 0xd8 || code === 0x00) fail('JPEG marker out of place');
    if (code === 0x01 || (code >= 0xd0 && code <= 0xd7)) {
      // Markers without a length
      kept.push(d.subarray(markerStart, pos));
      continue;
    }

    if (pos + 2 > d.length) fail('JPEG ends inside a segment');
    const length = (d[pos] << 8) | d[pos + 1];
    const end = pos + length;
    if (length < 2 || end > d.length) fail('JPEG segment overruns the file');
    const body = pos + 2;

    if (code === 0xda) {
      // Start of scan: the header, then entropy-coded data up to the next real
      // marker. Inside the data 0xFF is followed by 0x00 (a stuffed byte) or a
      // restart marker; 0xFF 0xFF is fill before a marker.
      if (width === 0 || height === 0) fail('JPEG scan before its frame header');
      let p = end;
      for (;;) {
        p = d.indexOf(0xff, p);
        if (p < 0 || p + 1 >= d.length) fail('JPEG image data has no end');
        const next = d[p + 1];
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) p += 2;
        else if (next === 0xff) p += 1;
        else break;
      }
      kept.push(d.subarray(markerStart, p));
      sawScan = true;
      pos = p;
      continue;
    }

    if ((code >= 0xe0 && code <= 0xef) || code === 0xfe) {
      // APPn and comments: keep only what changes how the picture is drawn
      if (code === 0xe0 && jfif === null && hasPrefix(d, body, end, JFIF) && length >= 16) {
        // JFIF without its optional thumbnail: header fields up to the densities, then 0 x 0
        const header = new Uint8Array(18);
        header.set([0xff, 0xe0, 0x00, 0x10]);
        header.set(d.subarray(body, body + 12), 4);
        jfif = header;
      } else if (code === 0xe1 && !sawExif && hasPrefix(d, body, end, EXIF)) {
        sawExif = true;
        orientation = readTiffOrientation(d, body + 6, end);
      } else if (code === 0xe2 && hasPrefix(d, body, end, ICC_PROFILE)) {
        kept.push(d.subarray(markerStart, end));
      } else if (code === 0xee && hasPrefix(d, body, end, ADOBE)) {
        kept.push(d.subarray(markerStart, end));
      }
      pos = end;
      continue;
    }

    if (isStartOfFrame(code)) {
      if (length < 8) fail('JPEG frame header too short');
      height = (d[body + 1] << 8) | d[body + 2];
      width = (d[body + 3] << 8) | d[body + 4];
      if (width === 0 || height === 0) fail('JPEG size not in its frame header');
    }
    // Tables, frame, restart interval and the like: the picture itself
    kept.push(d.subarray(markerStart, end));
    pos = end;
  }

  const parts: Uint8Array[] = [Uint8Array.of(0xff, 0xd8)];
  if (jfif) parts.push(jfif);
  if (orientation !== 1) parts.push(orientationSegment(orientation));
  parts.push(...kept);
  return { bytes: concat(parts), width, height, orientation };
}

// ─── PNG ─────────────────────────────────────────────────────────────

/**
 * Chunks that hold the picture or say how to colour it. Everything else
 * (text, EXIF, time, animation frames, private chunks) is left out; an
 * animated PNG becomes its first frame.
 */
const PNG_KEPT_CHUNKS = new Set([
  'IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'sBIT', 'cICP', 'mDCV', 'cLLI',
]);

/**
 * A PNG with every metadata chunk removed. The kept chunks, CRCs included,
 * are copied unchanged. A PNG that asks to be shown rotated (an eXIf chunk
 * with an orientation other than 1) throws: PNG has no other place for
 * that, so it needs a re-encode with the rotation applied.
 */
export function stripPngMetadata(d: Uint8Array): StrippedImage {
  if (sniffImageFormat(d) !== 'png') fail('not a PNG');

  const parts: Uint8Array[] = [d.subarray(0, 8)];
  let width = 0;
  let height = 0;
  let sawData = false;
  let pos = 8;
  let first = true;

  for (;;) {
    if (pos + 12 > d.length) fail('PNG ends before its end chunk');
    const length = ((d[pos] << 24) | (d[pos + 1] << 16) | (d[pos + 2] << 8) | d[pos + 3]) >>> 0;
    if (length > 0x7fffffff) fail('PNG chunk length invalid');
    const end = pos + 12 + length;
    if (end > d.length) fail('PNG chunk overruns the file');

    let type = '';
    for (let i = 4; i < 8; i++) {
      const c = d[pos + i];
      const letter = (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
      if (!letter) fail('PNG chunk type invalid');
      type += String.fromCharCode(c);
    }
    const data = pos + 8;

    if (first) {
      if (type !== 'IHDR' || length !== 13) fail('PNG does not start with its header');
      width = ((d[data] << 24) | (d[data + 1] << 16) | (d[data + 2] << 8) | d[data + 3]) >>> 0;
      height = ((d[data + 4] << 24) | (d[data + 5] << 16) | (d[data + 6] << 8) | d[data + 7]) >>> 0;
      if (width === 0 || height === 0) fail('PNG size invalid');
      first = false;
    }

    if (type === 'eXIf' && readTiffOrientation(d, data, data + length) !== 1) {
      fail('PNG asks to be rotated');
    }
    if (type === 'IDAT') sawData = true;

    if (PNG_KEPT_CHUNKS.has(type)) {
      parts.push(d.subarray(pos, end));
    } else if ((d[pos + 4] & 0x20) === 0) {
      // An unknown critical chunk (upper-case first letter) cannot be dropped safely
      fail(`PNG chunk ${type} unknown`);
    }

    pos = end;
    if (type === 'IEND') break; // anything after the end chunk is dropped
  }

  if (!sawData) fail('PNG has no image data');
  return { bytes: concat(parts), width, height, orientation: 1 };
}
