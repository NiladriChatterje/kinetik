import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import sharp from 'sharp';
import type { Sharp } from 'sharp';
import {
  ImageMetadataError,
  readTiffOrientation,
  sniffImageFormat,
  stripJpegMetadata,
  stripPngMetadata,
} from '../services/imageMetadata';

// ─── Helpers ─────────────────────────────────────────────────────────

/** A photo-like picture (gradients and noise), so the encoders do real work. */
async function picture(width: number, height: number): Promise<Sharp> {
  const raw = Buffer.alloc(width * height * 3);
  let seed = 12345;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const i = (y * width + x) * 3;
      raw[i] = (x * 255) / width;
      raw[i + 1] = (y * 255) / height;
      raw[i + 2] = seed & 0xff;
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } });
}

/** A camera-style JPEG: GPS and camera EXIF, orientation, XMP, an ICC profile. */
async function cameraJpeg(opts: { orientation?: number; progressive?: boolean } = {}): Promise<Buffer> {
  const img = await picture(160, 120);
  return img
    .jpeg({ quality: 90, progressive: opts.progressive ?? false })
    .withExif({
      IFD0: { Make: 'SECRETMAKE', Model: 'SECRETMODEL', Copyright: 'SECRET-OWNER' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '22/1 34/1 1234/100', GPSLongitudeRef: 'E', GPSLongitude: '88/1 21/1 0/1' },
    })
    .withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description>SECRET-XMP</rdf:Description></rdf:RDF></x:xmpmeta>')
    .withIccProfile('p3')
    .withMetadata({ orientation: opts.orientation ?? 1 })
    .toBuffer();
}

/** Insert a segment right after SOI. */
function withSegment(jpeg: Buffer, marker: number, payload: Buffer): Buffer {
  const header = Buffer.from([0xff, marker, ((payload.length + 2) >> 8) & 0xff, (payload.length + 2) & 0xff]);
  return Buffer.concat([jpeg.subarray(0, 2), header, payload, jpeg.subarray(2)]);
}

async function rawPixels(image: Buffer, autoOrient = false): Promise<Buffer> {
  const s = sharp(image);
  return (autoOrient ? s.rotate() : s).raw().toBuffer();
}

/** Bytes from the first start-of-scan marker to the end-of-image marker. */
function scanData(jpeg: Uint8Array): Buffer {
  const b = Buffer.from(jpeg);
  const sos = b.indexOf(Buffer.from([0xff, 0xda]));
  const eoi = b.lastIndexOf(Buffer.from([0xff, 0xd9]));
  return b.subarray(sos, eoi + 2);
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function pngChunk(type: string, data: Buffer): Buffer {
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  let c = 0xffffffff;
  for (const byte of typeAndData) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  typeAndData.copy(out, 4);
  out.writeUInt32BE((c ^ 0xffffffff) >>> 0, 8 + data.length);
  return out;
}

/** Insert chunks right after IHDR (8-byte signature + 25-byte IHDR chunk). */
function withPngChunks(png: Buffer, chunks: Buffer[]): Buffer {
  return Buffer.concat([png.subarray(0, 33), ...chunks, png.subarray(33)]);
}

function withoutPngChunk(png: Buffer, type: string): Buffer {
  const parts = [png.subarray(0, 8)];
  let pos = 8;
  while (pos < png.length) {
    const end = pos + 12 + png.readUInt32BE(pos);
    if (png.toString('latin1', pos + 4, pos + 8) !== type) parts.push(png.subarray(pos, end));
    pos = end;
  }
  return Buffer.concat(parts);
}

/** A big-endian TIFF block whose only entry is Orientation. */
function tiffWithOrientation(orientation: number, little = false): Buffer {
  const b = Buffer.alloc(26);
  if (little) {
    b.write('II', 0, 'ascii');
    b.writeUInt16LE(42, 2);
    b.writeUInt32LE(8, 4);
    b.writeUInt16LE(1, 8);
    b.writeUInt16LE(0x0112, 10);
    b.writeUInt16LE(3, 12);
    b.writeUInt32LE(1, 14);
    b.writeUInt16LE(orientation, 18);
  } else {
    b.write('MM', 0, 'ascii');
    b.writeUInt16BE(42, 2);
    b.writeUInt32BE(8, 4);
    b.writeUInt16BE(1, 8);
    b.writeUInt16BE(0x0112, 10);
    b.writeUInt16BE(3, 12);
    b.writeUInt32BE(1, 14);
    b.writeUInt16BE(orientation, 18);
  }
  return b;
}

const has = (bytes: Uint8Array, text: string) => Buffer.from(bytes).includes(Buffer.from(text, 'latin1'));

// ─── JPEG ────────────────────────────────────────────────────────────

describe('stripJpegMetadata', () => {
  it('keeps every pixel and drops GPS, camera, XMP, comments and trailing data', async () => {
    const camera = await cameraJpeg({ orientation: 6 });
    expect(has(camera, 'SECRET-OWNER')).toBe(true);
    expect(has(camera, 'SECRET-XMP')).toBe(true);
    // A comment segment and a motion-photo style trailer after the image
    const input = Buffer.concat([
      withSegment(camera, 0xfe, Buffer.from('SECRET-COMMENT')),
      Buffer.from('SECRET-TRAILER-VIDEO'),
    ]);

    const out = stripJpegMetadata(input);

    for (const secret of ['SECRET-OWNER', 'SECRETMAKE', 'SECRETMODEL', 'SECRET-XMP', 'SECRET-COMMENT', 'SECRET-TRAILER', 'xmpmeta']) {
      expect(has(out.bytes, secret)).toBe(false);
    }
    // Image data copied byte for byte; decoded pixels identical
    expect(scanData(out.bytes).equals(scanData(input))).toBe(true);
    expect((await rawPixels(Buffer.from(out.bytes))).equals(await rawPixels(input))).toBe(true);
    expect(out.width).toBe(160);
    expect(out.height).toBe(120);
    expect(out.orientation).toBe(6);
  });

  it('keeps the orientation as a one-tag EXIF block, so the photo still shows upright', async () => {
    const out = stripJpegMetadata(await cameraJpeg({ orientation: 6 }));
    const meta = await sharp(Buffer.from(out.bytes)).metadata();
    expect(meta.orientation).toBe(6);
    // The only EXIF left is the 36-byte orientation segment (6 + 26 bytes of payload)
    expect(meta.exif?.length).toBe(32);
    // Upright pixels match the original's upright pixels
    const camera = await cameraJpeg({ orientation: 6 });
    expect((await rawPixels(Buffer.from(out.bytes), true)).equals(await rawPixels(camera, true))).toBe(true);
  });

  it('writes no EXIF at all for an upright photo', async () => {
    const out = stripJpegMetadata(await cameraJpeg({ orientation: 1 }));
    expect(has(out.bytes, 'Exif')).toBe(false);
    expect(out.orientation).toBe(1);
    const meta = await sharp(Buffer.from(out.bytes)).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
  });

  it('keeps the colour profile', async () => {
    const out = stripJpegMetadata(await cameraJpeg());
    const meta = await sharp(Buffer.from(out.bytes)).metadata();
    expect(meta.icc).toBeDefined();
    expect(meta.icc!.length).toBeGreaterThan(100);
  });

  it('handles progressive JPEGs (many scans)', async () => {
    const input = await cameraJpeg({ progressive: true, orientation: 3 });
    const out = stripJpegMetadata(input);
    expect(has(out.bytes, 'SECRET')).toBe(false);
    expect((await rawPixels(Buffer.from(out.bytes))).equals(await rawPixels(input))).toBe(true);
    expect(out.orientation).toBe(3);
  });

  it('keeps JFIF without its thumbnail, first after SOI', async () => {
    const plain = await (await picture(32, 32)).jpeg().toBuffer(); // sharp writes a JFIF APP0
    // A JFIF header claiming a 1 x 1 thumbnail (3 bytes of RGB)
    const jfifWithThumb = Buffer.from([0x4a, 0x46, 0x49, 0x46, 0x00, 1, 2, 0, 0, 1, 0, 1, 1, 1, 9, 9, 9]);
    const input = withSegment(stripApp0(plain), 0xe0, jfifWithThumb);
    const out = stripJpegMetadata(input);
    expect(Array.from(out.bytes.subarray(0, 6))).toEqual([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    expect(Array.from(out.bytes.subarray(18, 20))).toEqual([0, 0]); // no thumbnail
    expect((await rawPixels(Buffer.from(out.bytes))).equals(await rawPixels(input))).toBe(true);
  });

  it('copies stuffed bytes, restart markers and fill bytes in the scan, and stops at the end marker', () => {
    // A hand-made stream: SOI, SOF0 (2 x 3), SOS, data with FF 00 and RST0, fill, EOI, trailer
    const input = Uint8Array.from([
      0xff, 0xd8,
      0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x03, 0x00, 0x02, 0x01, 0x01, 0x11, 0x00,
      0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,
      0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56, 0xff, 0xff, 0xd9,
      0x53, 0x45, 0x43, 0x52, 0x45, 0x54,
    ]);
    const out = stripJpegMetadata(input);
    expect(Array.from(out.bytes)).toEqual(Array.from(input.subarray(0, input.length - 6)));
    expect(out.width).toBe(2);
    expect(out.height).toBe(3);
  });

  it('refuses a cut-off file', async () => {
    const input = await cameraJpeg();
    expect(() => stripJpegMetadata(input.subarray(0, Math.floor(input.length / 2)))).toThrow(ImageMetadataError);
    expect(() => stripJpegMetadata(input.subarray(0, 40))).toThrow(ImageMetadataError);
  });

  it('refuses unreadable EXIF rather than guess the orientation', async () => {
    const plain = await (await picture(16, 16)).jpeg().toBuffer();
    const badExif = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), Buffer.from('XX\0*\0\0\0\x08', 'latin1')]);
    expect(() => stripJpegMetadata(withSegment(plain, 0xe1, badExif))).toThrow(ImageMetadataError);
  });

  it('refuses a file that is not a JPEG', () => {
    expect(() => stripJpegMetadata(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toThrow(ImageMetadataError);
  });
});

/** Remove sharp's own JFIF APP0 so a test can insert its own. */
function stripApp0(jpeg: Buffer): Buffer {
  if (jpeg[2] !== 0xff || jpeg[3] !== 0xe0) return jpeg;
  const len = jpeg.readUInt16BE(4);
  return Buffer.concat([jpeg.subarray(0, 2), jpeg.subarray(4 + len)]);
}

describe('readTiffOrientation', () => {
  it('reads both byte orders', () => {
    const be = tiffWithOrientation(8);
    const le = tiffWithOrientation(5, true);
    expect(readTiffOrientation(be, 0, be.length)).toBe(8);
    expect(readTiffOrientation(le, 0, le.length)).toBe(5);
  });

  it('treats a missing or out-of-range value as upright', () => {
    const odd = tiffWithOrientation(9);
    expect(readTiffOrientation(odd, 0, odd.length)).toBe(1);
    const none = tiffWithOrientation(6);
    none.writeUInt16BE(0x010f, 10); // the entry is now Make, not Orientation
    expect(readTiffOrientation(none, 0, none.length)).toBe(1);
  });

  it('refuses a directory that points outside the block', () => {
    const b = tiffWithOrientation(6);
    b.writeUInt32BE(400, 4);
    expect(() => readTiffOrientation(b, 0, b.length)).toThrow(ImageMetadataError);
  });
});

// ─── PNG ─────────────────────────────────────────────────────────────

describe('stripPngMetadata', () => {
  it('keeps the pixels and drops text, EXIF, time, private chunks and trailing data', async () => {
    const png = await (await picture(40, 30)).png().toBuffer();
    const input = Buffer.concat([
      withPngChunks(png, [
        pngChunk('tEXt', Buffer.from('Comment\0SECRET-TEXT', 'latin1')),
        pngChunk('eXIf', tiffWithOrientation(1)),
        pngChunk('tIME', Buffer.from([7, 234, 11, 7, 1, 2, 3])),
        pngChunk('prVt', Buffer.from('SECRET-PRIVATE', 'latin1')),
      ]),
      Buffer.from('SECRET-TRAILER'),
    ]);

    const out = stripPngMetadata(input);

    for (const secret of ['SECRET', 'tEXt', 'eXIf', 'tIME', 'prVt']) expect(has(out.bytes, secret)).toBe(false);
    expect((await rawPixels(Buffer.from(out.bytes))).equals(await rawPixels(png))).toBe(true);
    expect(out.width).toBe(40);
    expect(out.height).toBe(30);
    // The rest of the file is the original PNG, chunk for chunk (less sharp's
    // pHYs print-density chunk, which is not needed to draw the picture)
    expect(Buffer.from(out.bytes).equals(withoutPngChunk(png, 'pHYs'))).toBe(true);
  });

  it('refuses a PNG that asks to be rotated', async () => {
    const png = await (await picture(8, 8)).png().toBuffer();
    expect(() => stripPngMetadata(withPngChunks(png, [pngChunk('eXIf', tiffWithOrientation(6))]))).toThrow(ImageMetadataError);
  });

  it('refuses an unknown critical chunk and a cut-off file', async () => {
    const png = await (await picture(8, 8)).png().toBuffer();
    expect(() => stripPngMetadata(withPngChunks(png, [pngChunk('ABCD', Buffer.alloc(2))]))).toThrow(ImageMetadataError);
    expect(() => stripPngMetadata(png.subarray(0, png.length - 6))).toThrow(ImageMetadataError);
  });
});

// ─── Format sniffing and the phone's copy ────────────────────────────

describe('sniffImageFormat', () => {
  it('goes by the bytes', async () => {
    expect(sniffImageFormat(await (await picture(8, 8)).jpeg().toBuffer())).toBe('jpeg');
    expect(sniffImageFormat(await (await picture(8, 8)).png().toBuffer())).toBe('png');
    expect(sniffImageFormat(await (await picture(8, 8)).webp().toBuffer())).toBe('other');
    // HEIC ("ftypheic" box), as the picker hands it over under a .jpeg name
    expect(sniffImageFormat(Buffer.from('\0\0\0\x18ftypheic\0\0\0\0', 'latin1'))).toBe('other');
    expect(sniffImageFormat(new Uint8Array(0))).toBe('other');
  });
});

describe('the mobile copy', () => {
  it('is identical to the server copy', () => {
    const server = readFileSync(resolve(__dirname, '../services/imageMetadata.ts'), 'utf8');
    const mobile = readFileSync(resolve(__dirname, '../../../mobile/src/utils/imageMetadata.ts'), 'utf8');
    expect(mobile.replace(/\r\n/g, '\n')).toBe(server.replace(/\r\n/g, '\n'));
  });
});
