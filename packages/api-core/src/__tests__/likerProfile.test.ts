import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import jwt from '@fastify/jwt';

// ─── Mocks ────────────────────────────────────────────────────────
// GET /matches/likes/:userId/profile: a liker's full profile, opened from
// the Likes list. The database answers by statement; premium and block
// state are set per test.

const VIEWER = '11111111-1111-4111-8111-111111111111';
const LIKER = '22222222-2222-4222-8222-222222222222';

let likeRow: { revealed_at: string | null } | null = null;
let userRow: Record<string, any> | null = null;
let premium = false;
let blocked = false;
// GET /matches/:id/partner: the viewer's active match with LIKER, when set
let matchRow: { partner_id: string } | null = null;

const mockQuery = vi.fn(async (sql: string, _params?: any[]) => {
  if (sql.includes('SELECT revealed_at FROM')) return { rows: likeRow ? [likeRow] : [], rowCount: likeRow ? 1 : 0 };
  if (sql.includes('TRUE AS liked_you') || sql.includes('FALSE AS liked_you')) {
    return { rows: userRow ? [userRow] : [], rowCount: userRow ? 1 : 0 };
  }
  if (sql.includes('WHERE id = $1 AND (user_a_id = $2 OR user_b_id = $2) AND is_active = TRUE')) {
    return { rows: matchRow ? [matchRow] : [], rowCount: matchRow ? 1 : 0 };
  }
  if (sql.includes('FROM profile_photos')) {
    return { rows: [{ user_id: LIKER, id: 'ph1', url: '/uploads/a.webp', thumbnail_url: '/uploads/a_thumb.webp', is_primary: true }], rowCount: 1 };
  }
  if (sql.includes('JOIN interests')) {
    return { rows: [{ user_id: LIKER, id: 'in1', name: 'Hiking', emoji: '', category: 'outdoors' }], rowCount: 1 };
  }
  return { rows: [], rowCount: 0 };
});

vi.mock('../services/database', async () => {
  const shared = await vi.importActual<any>('@kinetik/shared');
  return { query: mockQuery, TABLES: shared.TABLES };
});
vi.mock('../services/premiumAccess', () => ({
  hasActivePremium: vi.fn(async () => premium),
  getChatAccess: vi.fn(),
  isChatLocked: vi.fn(),
  invalidateFreeChatCache: vi.fn(),
  CHAT_LOCKED: 'CHAT_LOCKED',
}));
vi.mock('../services/blocks', () => ({
  isBlockedPair: vi.fn(async () => blocked),
  isReportedPair: vi.fn(async () => false),
}));
vi.mock('../services/notificationService', () => ({ notificationEvents: {} }));
vi.mock('../services/eventBus', () => ({ eventBus: { publish: vi.fn(), sendMatchEvent: vi.fn() } }));
vi.mock('../services/redis', () => ({ getRedis: () => ({}), publishChatMessage: vi.fn() }));
vi.mock('../services/photoStorage', () => ({
  savePhoto: vi.fn(),
  saveEncryptedChatFile: vi.fn(),
  getEncryptedChatFileBuffer: vi.fn(),
  deleteChatFile: vi.fn(),
}));

// ─── App ──────────────────────────────────────────────────────────

let app: FastifyInstance;
let token: string;

beforeAll(async () => {
  const { matchRoutes } = await import('../routes/matches');
  app = Fastify();
  await app.register(jwt, { secret: 'test-secret' });
  await app.register(matchRoutes, { prefix: '/api/v1/matches' });
  await app.ready();
  token = app.jwt.sign({ sub: VIEWER });
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  mockQuery.mockClear();
  likeRow = { revealed_at: '2026-10-21T10:00:00Z' };
  userRow = {
    id: LIKER, display_name: 'Priya', date_of_birth: '1999-05-05', bio: 'Trekker', occupation: 'Designer',
    education: null, pronouns: null, is_verified: true, dating_category: 'serious',
    about_answers: { hobbies: ['Hiking'] }, h3_index: null, liked_you: true,
  };
  premium = false;
  blocked = false;
  matchRow = { partner_id: LIKER };
});

const MATCH = '33333333-3333-4333-8333-333333333333';

function getPartner(id = MATCH) {
  return app.inject({
    method: 'GET',
    url: `/api/v1/matches/${id}/partner`,
    headers: { authorization: `Bearer ${token}` },
  });
}

describe('GET /matches/:id/partner', () => {
  it('returns the full card of the other person in an active match', async () => {
    const res = await getPartner();
    expect(res.statusCode).toBe(200);
    const { profile } = res.json().data;
    expect(profile).toMatchObject({ userId: LIKER, displayName: 'Priya', bio: 'Trekker', isVerified: true });
    expect(profile.photos).toHaveLength(1);
    // Being matched says nothing about a waiting like
    expect(profile.likedYou).toBe(false);
    const [, params] = mockQuery.mock.calls.find(([s]) => String(s).includes('AND is_active = TRUE'))!;
    expect(params).toEqual([MATCH, VIEWER]);
  });

  it('404 when the match is not the viewer\'s, or is over', async () => {
    matchRow = null;
    expect((await getPartner()).statusCode).toBe(404);
  });

  it('404 across a block', async () => {
    blocked = true;
    expect((await getPartner()).statusCode).toBe(404);
  });

  it('404 for a deactivated partner account', async () => {
    userRow = null;
    expect((await getPartner()).statusCode).toBe(404);
  });

  it('404 for a malformed id, without touching the database', async () => {
    expect((await getPartner('not-a-match')).statusCode).toBe(404);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

function getProfile(id = LIKER) {
  return app.inject({
    method: 'GET',
    url: `/api/v1/matches/likes/${id}/profile`,
    headers: { authorization: `Bearer ${token}` },
  });
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('GET /matches/likes/:userId/profile', () => {
  it('returns the full card for a revealed like', async () => {
    const res = await getProfile();
    expect(res.statusCode).toBe(200);
    const { profile } = res.json().data;
    expect(profile).toMatchObject({
      userId: LIKER,
      displayName: 'Priya',
      bio: 'Trekker',
      occupation: 'Designer',
      datingCategory: 'serious',
      isVerified: true,
      likedYou: true,
      aboutAnswers: { hobbies: ['Hiking'] },
    });
    expect(profile.photos).toEqual([{ id: 'ph1', url: '/uploads/a.webp', thumbnailUrl: '/uploads/a_thumb.webp', isPrimary: true }]);
    expect(profile.interests[0].name).toBe('Hiking');
    expect(profile.age).toBeGreaterThan(18);
  });

  it('only looks up a like from that person to the viewer, still waiting', async () => {
    await getProfile();
    const [sql, params] = mockQuery.mock.calls.find(([s]) => String(s).includes('SELECT revealed_at FROM'))!;
    expect(params).toEqual([LIKER, VIEWER]);
    expect(sql).toContain('is_mutual = FALSE AND responded_at IS NULL');
  });

  it('404 when there is no waiting like (answered, withdrawn or never sent)', async () => {
    likeRow = null;
    expect((await getProfile()).statusCode).toBe(404);
  });

  it('404 for a free account whose like is not revealed', async () => {
    likeRow = { revealed_at: null };
    expect((await getProfile()).statusCode).toBe(404);
  });

  it('Premium sees an unrevealed like', async () => {
    likeRow = { revealed_at: null };
    premium = true;
    expect((await getProfile()).statusCode).toBe(200);
  });

  it('404 across a block', async () => {
    blocked = true;
    expect((await getProfile()).statusCode).toBe(404);
  });

  it('404 for a deactivated account', async () => {
    userRow = null;
    expect((await getProfile()).statusCode).toBe(404);
  });

  it('404 without touching the database for an id that is not a UUID', async () => {
    const res = await getProfile('not-a-uuid');
    expect(res.statusCode).toBe(404);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('401 without a token', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/matches/likes/${LIKER}/profile` });
    expect(res.statusCode).toBe(401);
  });
});
