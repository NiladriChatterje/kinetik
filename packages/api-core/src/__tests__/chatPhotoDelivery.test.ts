import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import jwt from '@fastify/jwt';

// ─── Chat photos live on the phones ───────────────────────────────
// The receiver's phone saves a photo and says so; the server then deletes
// its file. Covers who may say so, that the file goes once, the check of
// which chats still exist, and the 30-day sweep of photos nobody saved.

const ME = '11111111-1111-4111-8111-111111111111';
const MATCH = '44444444-4444-4444-8444-444444444444';
const MEDIA = '77777777-7777-4777-8777-777777777777';

let updateRows: Array<{ url: string }> = [];
let activeRows: Array<{ id: string }> = [];
let unsavedBatches: Array<Array<{ id: string; url: string }>> = [];

const mockQuery = vi.fn(async (sql: string, _params?: any[]) => {
  const s = sql.replace(/\s+/g, ' ');
  if (s.includes('SET delivered_at = NOW(), file_removed_at = NOW()')) return { rows: updateRows, rowCount: updateRows.length };
  if (s.includes('WHERE id = ANY($1::uuid[]) AND is_active = TRUE')) return { rows: activeRows, rowCount: activeRows.length };
  if (s.includes('SELECT id, url, thumbnail_url FROM chat_media')) {
    const rows = unsavedBatches.shift() ?? [];
    return { rows, rowCount: rows.length };
  }
  return { rows: [], rowCount: 0 };
});
const mockDelete = vi.fn(async (_key: string) => {});

vi.mock('../services/database', async () => {
  const shared = await vi.importActual<any>('@kinetik/shared');
  return { query: mockQuery, TABLES: shared.TABLES };
});
vi.mock('../services/notificationService', () => ({ notificationEvents: {} }));
vi.mock('../services/eventBus', () => ({ eventBus: { publish: vi.fn(), sendMatchEvent: vi.fn() } }));
vi.mock('../services/redis', () => ({ getRedis: () => ({}), publishChatMessage: vi.fn() }));
vi.mock('../services/photoStorage', () => ({
  saveChatImage: vi.fn(),
  ChatImageRejected: class extends Error {},
  saveEncryptedChatFile: vi.fn(),
  getEncryptedChatFileBuffer: vi.fn(),
  deleteChatFile: mockDelete,
}));

let app: FastifyInstance;

beforeAll(async () => {
  const { matchRoutes } = await import('../routes/matches');
  app = Fastify();
  await app.register(jwt, { secret: 'test-secret' });
  await app.register(matchRoutes, { prefix: '/api/v1/matches' });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  mockQuery.mockClear();
  mockDelete.mockClear();
  updateRows = [];
  activeRows = [];
  unsavedBatches = [];
});

const post = (url: string, payload?: unknown, userId = ME) =>
  app.inject({
    method: 'POST',
    url: `/api/v1/matches/${url}`,
    payload: payload as any,
    headers: { authorization: `Bearer ${app.jwt.sign({ sub: userId })}` },
  });

describe('a photo saved on the phone', () => {
  it('the receiver says so: the server file is deleted, once', async () => {
    updateRows = [{ url: `/uploads/sender-1/abc.webp`, thumbnail_url: null } as any];
    const res = await post(`${MATCH}/media/${MEDIA}/saved`);
    expect(res.statusCode).toBe(200);
    expect(res.json().data.removed).toBe(true);
    expect(mockDelete).toHaveBeenCalledWith('sender-1/abc.webp');

    // The update is scoped to the receiver, the chat, a normal photo still on the server
    const [sql, params] = mockQuery.mock.calls.find(([q]) => String(q).includes('delivered_at'))!;
    expect(params).toEqual([MEDIA, MATCH, ME]);
    expect(String(sql)).toContain('cm.sender_id <> $3');
    expect(String(sql)).toContain('(mt.user_a_id = $3 OR mt.user_b_id = $3)');
    expect(String(sql)).toContain('cm.is_view_once = FALSE');
    expect(String(sql)).toContain('cm.file_removed_at IS NULL');
  });

  it('a photo sent before this change takes its old thumbnail file with it', async () => {
    updateRows = [{ url: '/uploads/s/old.webp', thumbnail_url: '/uploads/s/old_thumb.webp' } as any];
    await post(`${MATCH}/media/${MEDIA}/saved`);
    expect(mockDelete.mock.calls.map((c) => c[0])).toEqual(['s/old.webp', 's/old_thumb.webp']);
  });

  it('said again, by the sender, or for another chat: nothing is deleted', async () => {
    const res = await post(`${MATCH}/media/${MEDIA}/saved`);
    expect(res.statusCode).toBe(200);
    expect(res.json().data.removed).toBe(false);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('refuses ids that are not ids, and needs a login', async () => {
    expect((await post(`not-a-match/media/${MEDIA}/saved`)).statusCode).toBe(404);
    expect((await post(`${MATCH}/media/nope/saved`)).statusCode).toBe(404);
    const anon = await app.inject({ method: 'POST', url: `/api/v1/matches/${MATCH}/media/${MEDIA}/saved` });
    expect(anon.statusCode).toBe(401);
  });
});

describe('which chats still exist', () => {
  it('answers with the active ones among those asked, for this user only', async () => {
    activeRows = [{ id: MATCH }];
    const other = '55555555-5555-4555-8555-555555555555';
    const res = await post('active-check', { matchIds: [MATCH, other] });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.active).toEqual([MATCH]);
    const [, params] = mockQuery.mock.calls.find(([q]) => String(q).includes('is_active = TRUE'))!;
    expect(params).toEqual([[MATCH, other], ME]);
  });

  it('an empty list needs no query; a bad one is refused', async () => {
    expect((await post('active-check', { matchIds: [] })).json().data.active).toEqual([]);
    expect(mockQuery).not.toHaveBeenCalled();
    expect((await post('active-check', { matchIds: ['x'] })).statusCode).toBe(400);
    expect((await post('active-check', {})).statusCode).toBe(400);
    expect((await post('active-check', { matchIds: new Array(501).fill(MATCH) })).statusCode).toBe(400);
  });
});

describe('photos nobody saved', () => {
  it('are deleted after 30 days, in batches, and marked', async () => {
    const { removeUnsavedChatPhotos, CHAT_PHOTO_HOLD_DAYS } = await import('../services/chatPhotoCleanup');
    expect(CHAT_PHOTO_HOLD_DAYS).toBe(30);
    unsavedBatches = [
      Array.from({ length: 200 }, (_, i) => ({ id: `id-${i}`, url: `/uploads/u/${i}.webp` })),
      [{ id: 'last', url: '/uploads/u/last.jpg' }],
    ];
    expect(await removeUnsavedChatPhotos()).toBe(201);
    expect(mockDelete).toHaveBeenCalledTimes(201);
    expect(mockDelete).toHaveBeenLastCalledWith('u/last.jpg');
    const marks = mockQuery.mock.calls.filter(([q]) => String(q).includes('SET file_removed_at = NOW()'));
    expect(marks).toHaveLength(2);
    expect(marks[1][1]).toEqual([['last']]);
  });

  it('a file already gone still gets its row marked', async () => {
    const { removeUnsavedChatPhotos } = await import('../services/chatPhotoCleanup');
    mockDelete.mockRejectedValueOnce(new Error('NoSuchKey'));
    unsavedBatches = [[{ id: 'a', url: '/uploads/u/a.webp' }]];
    expect(await removeUnsavedChatPhotos()).toBe(1);
    expect(mockQuery.mock.calls.some(([q]) => String(q).includes('SET file_removed_at = NOW()'))).toBe(true);
  });
});
