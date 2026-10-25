import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';

// ─── Profile photos: there is always a primary one ──────────────────
// Drives the real photo routes over HTTP against a small in-memory table.
// The primary photo is the face everyone else sees (chat list, chat header,
// likes, pushes); a profile with photos must never be without one, which
// happened once when a member replaced all their photos.

const ME = '11111111-1111-4111-8111-111111111111';
const P1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const P2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const P3 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';

interface Photo { id: string; user_id: string; url: string; is_primary: boolean; order_index: number; created_at: Date }

let photos: Photo[];
let onboardingComplete: boolean;
let seq = 0;

function runQuery(text: string, params: any[] = []): { rows: any[]; rowCount: number } {
  const sql = text.replace(/\s+/g, ' ').trim();
  const out = (rows: any[]) => ({ rows, rowCount: rows.length });
  const mine = (userId: string) => photos.filter((p) => p.user_id === userId);

  if (sql.startsWith('SELECT COUNT(*)::int AS count, COALESCE(MAX(order_index), -1) + 1 AS next_index')) {
    const list = mine(params[0]);
    return out([{
      count: list.length,
      next_index: list.length ? Math.max(...list.map((p) => p.order_index)) + 1 : 0,
      primaries: list.filter((p) => p.is_primary).length,
    }]);
  }
  if (sql.startsWith('INSERT INTO profile_photos')) {
    const [user_id, url, thumbnail_url, blur_hash, order_index, is_primary] = params;
    const row: Photo = { id: `new-${++seq}`, user_id, url, is_primary, order_index, created_at: new Date(2026, 9, 25, 0, seq) };
    photos.push(row);
    return out([{ id: row.id, url, thumbnail_url, blur_hash, is_primary, order_index, created_at: row.created_at }]);
  }
  if (sql.startsWith('SELECT id, url, is_primary FROM profile_photos WHERE id = $1 AND user_id = $2')) {
    return out(photos.filter((p) => p.id === params[0] && p.user_id === params[1]));
  }
  if (sql.startsWith('SELECT u.onboarding_complete,')) {
    return out([{ onboarding_complete: onboardingComplete, photo_count: mine(params[0]).length }]);
  }
  if (sql.startsWith('UPDATE profile_photos SET is_primary = TRUE WHERE id = (SELECT id FROM profile_photos WHERE user_id = $1')) {
    const first = [...mine(params[0])].sort(
      (a, b) => a.order_index - b.order_index || a.created_at.getTime() - b.created_at.getTime(),
    )[0];
    if (first) first.is_primary = true;
    return out([]);
  }
  throw new Error(`Unexpected SQL in test: ${sql.slice(0, 120)}`);
}

const mockQuery = vi.fn(async (text: string, params?: any[]) => runQuery(text, params));

vi.mock('../services/database', () => ({
  query: mockQuery,
  TABLES: { USERS: 'users', PROFILE_PHOTOS: 'profile_photos' },
  getPhotosByUserId: async (userId: string) =>
    photos.filter((p) => p.user_id === userId).sort((a, b) => a.order_index - b.order_index),
  deletePhotoById: async (id: string, userId: string) => {
    const i = photos.findIndex((p) => p.id === id && p.user_id === userId);
    if (i < 0) return null;
    const [row] = photos.splice(i, 1);
    return { id: row.id };
  },
  setPrimaryPhoto: vi.fn(),
}));

vi.mock('../services/photoStorage', () => ({
  savePhoto: vi.fn(async (userId: string) => ({
    url: `/photos/${userId}/new.jpg`,
    thumbnailUrl: `/photos/${userId}/new-thumb.jpg`,
    blurHash: 'LEHV6nWB2yk8',
  })),
  deletePhoto: vi.fn(async () => undefined),
}));

let app: FastifyInstance;
let auth: Record<string, string>;

beforeAll(async () => {
  const { photoRoutes } = await import('../routes/photos');
  app = Fastify();
  await app.register(jwt, { secret: 'test-secret' });
  await app.register(multipart, { limits: { fileSize: 1024 * 1024 } });
  await app.register(photoRoutes, { prefix: '/api/v1/users/photos' });
  await app.ready();
  auth = { authorization: `Bearer ${app.jwt.sign({ sub: ME })}` };
});

afterAll(async () => {
  await app.close();
});

const photo = (id: string, is_primary: boolean, order_index: number): Photo => ({
  id, user_id: ME, url: `/photos/${id}.jpg`, is_primary, order_index, created_at: new Date(2026, 9, 20, 0, order_index),
});

beforeEach(() => {
  vi.clearAllMocks();
  photos = [];
  onboardingComplete = true;
  seq = 0;
});

const BOUNDARY = 'kinetik-test-boundary';
const upload = () =>
  app.inject({
    method: 'POST',
    url: '/api/v1/users/photos',
    headers: { ...auth, 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
    payload:
      `--${BOUNDARY}\r\n` +
      'Content-Disposition: form-data; name="photo"; filename="me.jpg"\r\n' +
      'Content-Type: image/jpeg\r\n\r\n' +
      'not-really-a-jpeg\r\n' +
      `--${BOUNDARY}--\r\n`,
  });

const remove = (id: string) => app.inject({ method: 'DELETE', url: `/api/v1/users/photos/${id}`, headers: auth });

const primaryIds = () => photos.filter((p) => p.is_primary).map((p) => p.id);

describe('upload', () => {
  it('the first photo becomes the primary one', async () => {
    const res = await upload();
    expect(res.statusCode).toBe(201);
    expect(res.json().data.is_primary).toBe(true);
    expect(res.json().data.order_index).toBe(0);
    expect(primaryIds()).toEqual(['new-1']);
  });

  it('a later photo is not primary and takes the next free order index', async () => {
    photos = [photo(P1, true, 2), photo(P2, false, 3)];
    const res = await upload();
    expect(res.statusCode).toBe(201);
    expect(res.json().data.is_primary).toBe(false);
    expect(res.json().data.order_index).toBe(4);
    expect(primaryIds()).toEqual([P1]);
  });

  it('a photo added while none is primary becomes the primary one', async () => {
    photos = [photo(P1, false, 2), photo(P2, false, 3)];
    const res = await upload();
    expect(res.statusCode).toBe(201);
    expect(res.json().data.is_primary).toBe(true);
    expect(primaryIds()).toEqual(['new-1']);
  });

  it('refuses a seventh photo', async () => {
    photos = [0, 1, 2, 3, 4, 5].map((i) => photo(`p${i}`, i === 0, i));
    const res = await upload();
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('PHOTO_LIMIT');
    expect(photos).toHaveLength(6);
  });
});

describe('delete on a finished profile', () => {
  it('refuses the primary photo while other photos remain', async () => {
    photos = [photo(P1, true, 0), photo(P2, false, 1), photo(P3, false, 2)];
    const res = await remove(P1);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('PRIMARY_PHOTO');
    expect(photos).toHaveLength(3);
    expect(primaryIds()).toEqual([P1]);
  });

  it('deletes another photo and keeps the primary one', async () => {
    photos = [photo(P1, true, 0), photo(P2, false, 1), photo(P3, false, 2)];
    const res = await remove(P3);
    expect(res.statusCode).toBe(200);
    expect(photos.map((p) => p.id)).toEqual([P1, P2]);
    expect(primaryIds()).toEqual([P1]);
  });

  it('still keeps the minimum of two photos', async () => {
    photos = [photo(P1, true, 0), photo(P2, false, 1)];
    const res = await remove(P2);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('NOT_ENOUGH_PHOTOS');
    expect(photos).toHaveLength(2);
  });

  it('says so for a photo that is not there', async () => {
    const res = await remove(P1);
    expect(res.statusCode).toBe(404);
  });
});

describe('delete during onboarding', () => {
  beforeEach(() => {
    onboardingComplete = false;
  });

  it('deleting the primary photo makes the next one primary', async () => {
    photos = [photo(P1, true, 0), photo(P3, false, 2), photo(P2, false, 1)];
    const res = await remove(P1);
    expect(res.statusCode).toBe(200);
    expect(photos.map((p) => p.id).sort()).toEqual([P2, P3].sort());
    expect(primaryIds()).toEqual([P2]);
  });

  it('deleting the only photo leaves nothing to promote', async () => {
    photos = [photo(P1, true, 0)];
    const res = await remove(P1);
    expect(res.statusCode).toBe(200);
    expect(photos).toHaveLength(0);
  });

  it('may go below two photos', async () => {
    photos = [photo(P1, true, 0), photo(P2, false, 1)];
    const res = await remove(P2);
    expect(res.statusCode).toBe(200);
    expect(primaryIds()).toEqual([P1]);
  });
});
