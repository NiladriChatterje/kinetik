import { describe, it, expect, vi, beforeEach } from 'vitest';
import sharp from 'sharp';
import type { Sharp } from 'sharp';

// Storage: capture what would be written instead of talking to MinIO
const puts: Array<{ Key: string; ContentType: string; Body: Buffer }> = [];
vi.mock('@aws-sdk/client-s3', () => {
  class Command {
    input: any;
    constructor(input: any) {
      this.input = input;
    }
  }
  return {
    S3Client: class {
      async send(cmd: Command) {
        puts.push(cmd.input);
        return {};
      }
    },
    PutObjectCommand: Command,
    GetObjectCommand: Command,
    DeleteObjectCommand: Command,
    ListObjectsV2Command: Command,
  };
});

import {
  cleanChatImage,
  makeChatPreview,
  saveChatImage,
  ChatImageRejected,
  CHAT_IMAGE_MAX_PIXELS,
} from '../services/photoStorage';

const has = (bytes: Buffer, text: string) => bytes.includes(Buffer.from(text, 'latin1'));

function located(img: Sharp): Sharp {
  return img.withExif({
    IFD0: { Make: 'SECRETMAKE', Copyright: 'SECRET-OWNER' },
    IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '22/1 34/1 0/1' },
  });
}

function canvas(width: number, height: number): Sharp {
  return sharp({ create: { width, height, channels: 3, background: { r: 180, g: 40, b: 90 } } });
}

beforeEach(() => {
  puts.length = 0;
});

describe('cleanChatImage', () => {
  it('JPEG: same image data, no GPS or camera details, orientation kept', async () => {
    const input = await located(canvas(120, 80).jpeg({ quality: 95 })).withMetadata({ orientation: 6 }).toBuffer();
    const clean = await cleanChatImage(input);
    expect(clean.mimeType).toBe('image/jpeg');
    expect(clean.ext).toBe('jpg');
    expect(has(clean.buffer, 'SECRET')).toBe(false);
    expect((await sharp(clean.buffer).metadata()).orientation).toBe(6);
    expect((await sharp(clean.buffer).raw().toBuffer()).equals(await sharp(input).raw().toBuffer())).toBe(true);
  });

  it('PNG: stripped, pixels unchanged', async () => {
    const input = await located(canvas(50, 40).png()).toBuffer();
    const clean = await cleanChatImage(input);
    expect(clean.mimeType).toBe('image/png');
    expect(has(clean.buffer, 'SECRET')).toBe(false);
    expect((await sharp(clean.buffer).raw().toBuffer()).equals(await sharp(input).raw().toBuffer())).toBe(true);
  });

  it('WebP without metadata (older app versions): stored exactly as sent', async () => {
    const input = await canvas(60, 40).webp({ quality: 85 }).toBuffer();
    const clean = await cleanChatImage(input);
    expect(clean.mimeType).toBe('image/webp');
    expect(clean.buffer.equals(input)).toBe(true);
  });

  it('WebP with metadata: re-encoded upright, metadata gone', async () => {
    const input = await located(canvas(60, 40).webp()).withMetadata({ orientation: 6 }).toBuffer();
    expect(has(input, 'SECRET')).toBe(true);
    const clean = await cleanChatImage(input);
    expect(clean.mimeType).toBe('image/jpeg');
    expect(has(clean.buffer, 'SECRET')).toBe(false);
    const meta = await sharp(clean.buffer).metadata();
    expect(meta.exif).toBeUndefined();
    expect([meta.width, meta.height]).toEqual([40, 60]); // the rotation was applied
  });

  it('GIF and other formats: re-encoded as JPEG', async () => {
    const input = await canvas(30, 20).gif().toBuffer();
    const clean = await cleanChatImage(input);
    expect(clean.mimeType).toBe('image/jpeg');
    expect((await sharp(clean.buffer).metadata()).format).toBe('jpeg');
  });

  it('refuses too many pixels, without decoding them', async () => {
    const side = Math.ceil(Math.sqrt(CHAT_IMAGE_MAX_PIXELS)) + 1;
    const input = await canvas(side, side).jpeg({ quality: 50 }).toBuffer();
    await expect(cleanChatImage(input)).rejects.toThrow('too many pixels');
  });

  it('refuses an empty file, a non-image and a cut-off JPEG', async () => {
    await expect(cleanChatImage(Buffer.alloc(0))).rejects.toBeInstanceOf(ChatImageRejected);
    await expect(cleanChatImage(Buffer.from('not a photo at all'))).rejects.toBeInstanceOf(ChatImageRejected);
    const jpeg = await canvas(200, 200).jpeg().toBuffer();
    await expect(
      cleanChatImage(jpeg.subarray(0, Math.floor(jpeg.length * 0.6))).then((c) => makeChatPreview(c.buffer)),
    ).rejects.toBeInstanceOf(ChatImageRejected);
  });
});

describe('makeChatPreview', () => {
  it('a tiny upright WebP, and the photo size as seen', async () => {
    const input = await canvas(1600, 1200).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const p = await makeChatPreview(input);
    expect([p.width, p.height]).toEqual([1200, 1600]);
    const meta = await sharp(Buffer.from(p.preview, 'base64')).metadata();
    expect(meta.format).toBe('webp');
    expect([meta.width, meta.height]).toEqual([15, 20]);
    expect(p.preview.length).toBeLessThan(600);
  });

  it('a tall screenshot keeps its shape', async () => {
    const p = await makeChatPreview(await canvas(1080, 2400).png().toBuffer());
    expect([p.width, p.height]).toEqual([1080, 2400]);
    const meta = await sharp(Buffer.from(p.preview, 'base64')).metadata();
    expect(meta.height).toBe(20);
  });
});

describe('saveChatImage', () => {
  it('stores only the clean photo, under its real type, with a preview and its size', async () => {
    const input = await located(canvas(900, 700).jpeg({ quality: 95 })).toBuffer();
    const saved = await saveChatImage('user-1', input);

    expect(saved.mimeType).toBe('image/jpeg');
    expect(saved.url).toMatch(/^\/uploads\/user-1\/[0-9a-f-]{36}\.jpg$/);
    expect([saved.width, saved.height]).toEqual([900, 700]);
    expect(saved.preview.length).toBeGreaterThan(0);

    expect(puts).toHaveLength(1); // no thumbnail file
    const full = puts[0];
    expect(saved.url.endsWith(full.Key)).toBe(true);
    expect(full.ContentType).toBe('image/jpeg');
    expect(has(full.Body, 'SECRET')).toBe(false);
    expect(saved.sizeBytes).toBe(full.Body.length);
    expect((await sharp(full.Body).raw().toBuffer()).equals(await sharp(input).raw().toBuffer())).toBe(true);
  });

  it('writes nothing for a rejected file', async () => {
    await expect(saveChatImage('user-1', Buffer.from('nope'))).rejects.toBeInstanceOf(ChatImageRejected);
    expect(puts).toHaveLength(0);
  });
});
