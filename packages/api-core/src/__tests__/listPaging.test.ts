import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import jwt from '@fastify/jwt';

// ─── What this covers ─────────────────────────────────────────────
// GET /matches/conversations and GET /matches/likes page by cursor. A page
// is the `limit` rows after the cursor in the list's order; `nextCursor` is
// null on the last page; the cursor carries the sort-key values of the last
// row, so a row that moves up after its page was shown is not repeated; and
// what the app needs whatever the page (every match id and the unread ones,
// the count of everyone who liked) comes with the first page only.
//
// The database is an in-memory model driven by the SQL the routes issue,
// ordered and bounded exactly the way Postgres orders and bounds the rows.

interface Match { id: string; user_a_id: string; user_b_id: string; matched_at: Date; is_active: boolean }
interface Message { match_id: string; sender_id: string; created_at: Date; read_at: Date | null }
interface Like { id: string; actor_id: string; target_id: string; created_at: Date; revealed: boolean; responded: boolean }

let matches: Match[];
let messages: Message[];
let likes: Like[];
let premiumUsers: Set<string>;

const ME = 'me';
const BASE = Date.UTC(2026, 0, 1);

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

/** The text form cursorTimestampSql() produces, for a Date with ms precision. */
function timestampText(d: Date): string {
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 23)}000+00`;
}
function parseTimestampText(s: string): Date {
  return new Date(`${s.slice(0, 10)}T${s.slice(11, 23)}Z`);
}

const desc = (a: number, b: number) => b - a;
const idDesc = (a: string, b: string) => (a < b ? 1 : a > b ? -1 : 0);

const mockQuery = vi.fn(async (sql: string, params: any[] = []) => {
  const text = sql.replace(/\s+/g, ' ');

  if (text.includes(') AS unread FROM matches m')) {
    const rows = matches
      .filter((m) => m.is_active && (m.user_a_id === params[0] || m.user_b_id === params[0]))
      .map((m) => ({
        id: m.id,
        unread: messages.some((x) => x.match_id === m.id && x.sender_id !== params[0] && x.read_at === null),
      }));
    return { rows, rowCount: rows.length };
  }

  if (text.includes('m.id as match_id')) {
    const [userId, limit] = params;
    let rows = matches
      .filter((m) => m.is_active && (m.user_a_id === userId || m.user_b_id === userId))
      .map((m) => {
        const last = messages
          .filter((x) => x.match_id === m.id)
          .sort((a, b) => desc(a.created_at.getTime(), b.created_at.getTime()))[0];
        const activity = last ? last.created_at : m.matched_at;
        return {
          match_id: m.id,
          partner_id: m.user_a_id === userId ? m.user_b_id : m.user_a_id,
          partner_name: 'Partner',
          is_active: true,
          last_message_content: null,
          last_message_at: last?.created_at ?? null,
          last_message_sender_id: last?.sender_id ?? null,
          unread_count: messages.filter((x) => x.match_id === m.id && x.sender_id !== userId && x.read_at === null).length,
          has_message: last ? 1 : 0,
          activity_text: timestampText(activity),
          _activity: activity.getTime(),
        };
      })
      .sort((a, b) => desc(a.has_message, b.has_message) || desc(a._activity, b._activity) || idDesc(a.match_id, b.match_id));
    if (text.includes('$5::uuid')) {
      const [, , flag, ts, id] = params;
      const cFlag = Number(flag);
      const cTime = parseTimestampText(ts).getTime();
      rows = rows.filter(
        (r) =>
          r.has_message < cFlag ||
          (r.has_message === cFlag && (r._activity < cTime || (r._activity === cTime && r.match_id < id))),
      );
    }
    rows = rows.slice(0, limit);
    return { rows, rowCount: rows.length };
  }

  if (text.includes('AS pending_count FROM user_interactions')) {
    const cnt = likes.filter((l) => l.target_id === params[0] && !l.responded).length;
    return { rows: [{ pending_count: cnt }], rowCount: 1 };
  }

  if (text.startsWith('WITH slots AS')) {
    // Reveals for a free account: the fixtures set revealed themselves
    return { rows: [], rowCount: 1 };
  }

  if (text.includes('FROM user_interactions ui JOIN users u ON u.id = ui.actor_id')) {
    const [userId, premium, limit] = params;
    let rows = likes
      .filter((l) => l.target_id === userId && !l.responded && (premium || l.revealed))
      .sort((a, b) => desc(a.created_at.getTime(), b.created_at.getTime()) || idDesc(a.id, b.id));
    if (text.includes('$5::uuid')) {
      const [, , , ts, id] = params;
      const cTime = parseTimestampText(ts).getTime();
      rows = rows.filter((l) => l.created_at.getTime() < cTime || (l.created_at.getTime() === cTime && l.id < id));
    }
    const page = rows.slice(0, limit).map((l) => ({
      liked_at: l.created_at,
      is_mutual: false,
      responded_at: null,
      revealed_at: l.revealed ? new Date() : null,
      action: 'like',
      user_id: l.actor_id,
      display_name: `Name of ${l.actor_id}`,
      bio: '',
      date_of_birth: null,
      is_verified: false,
      dating_category: null,
      photo_url: null,
      thumbnail_url: null,
      like_id: l.id,
      liked_at_text: timestampText(l.created_at),
    }));
    return { rows: page, rowCount: page.length };
  }

  throw new Error(`unexpected SQL in test: ${text}`);
});

vi.mock('../services/database', () => ({
  query: mockQuery,
  TABLES: {
    USERS: 'users',
    MATCHES: 'matches',
    MESSAGES: 'messages',
    CHAT_MEDIA: 'chat_media',
    USER_INTERACTIONS: 'user_interactions',
    USER_PREFERENCES: 'user_preferences',
    PROFILE_PHOTOS: 'profile_photos',
    SUBSCRIPTION_LEDGER: 'subscription_ledger',
  },
}));

vi.mock('../services/premiumAccess', () => ({
  hasActivePremium: async (userId: string) => premiumUsers.has(userId),
  getChatAccess: async () => ({ isLocked: () => false }),
  isChatLocked: async () => false,
  invalidateFreeChatCache: vi.fn(),
  CHAT_LOCKED: 'CHAT_LOCKED',
}));

vi.mock('../services/eventBus', () => ({ eventBus: { publish: vi.fn().mockResolvedValue(undefined) } }));
vi.mock('../services/notificationService', () => ({
  notificationEvents: { newMessage: vi.fn(), newMatch: vi.fn(), newLike: vi.fn() },
}));
vi.mock('../services/redis', () => ({
  getRedis: () => ({ get: vi.fn(), del: vi.fn(), publish: vi.fn() }),
  publishChatMessage: vi.fn(),
}));
vi.mock('../services/photoStorage', () => ({
  savePhoto: vi.fn(),
  saveEncryptedChatFile: vi.fn(),
  getEncryptedChatFileBuffer: vi.fn(),
  deleteChatFile: vi.fn(),
}));

// ─── Fixtures ─────────────────────────────────────────────────────

/**
 * Seven active matches for ME. Five have messages; m5 and m4 share their
 * last message's timestamp, so the 3rd and 4th rows tie on time and are
 * ordered by id. m2 and m1 have no messages and follow, newest match first.
 * Expected order: m7, m6, m5, m4, m3, m2, m1.
 */
function seedConversations() {
  matches = [];
  messages = [];
  for (let k = 1; k <= 7; k++) {
    matches.push({ id: uuid(k), user_a_id: ME, user_b_id: `partner-${k}`, matched_at: new Date(BASE + k * 60_000), is_active: true });
  }
  // Older match that is over: never listed
  matches.push({ id: uuid(99), user_a_id: ME, user_b_id: 'gone', matched_at: new Date(BASE), is_active: false });
  // Someone else's match: never listed
  matches.push({ id: uuid(98), user_a_id: 'x', user_b_id: 'y', matched_at: new Date(BASE + 999 * 60_000), is_active: true });
  const at = (minutes: number) => new Date(BASE + 1000 * 60_000 + minutes * 60_000);
  messages.push({ match_id: uuid(7), sender_id: 'partner-7', created_at: at(70), read_at: null }); // unread
  messages.push({ match_id: uuid(6), sender_id: ME, created_at: at(60), read_at: null }); // own: not unread
  messages.push({ match_id: uuid(5), sender_id: 'partner-5', created_at: at(50), read_at: new Date() });
  messages.push({ match_id: uuid(4), sender_id: 'partner-4', created_at: at(50), read_at: null }); // unread, same time as m5
  messages.push({ match_id: uuid(3), sender_id: 'partner-3', created_at: at(30), read_at: new Date() });
}

/** 30 pending likes on ME, newest first by index; 25 and 26 share a time. */
function seedLikes() {
  likes = [];
  for (let k = 1; k <= 30; k++) {
    const minute = k === 26 ? 25 : k;
    likes.push({
      id: uuid(100 + k),
      actor_id: `liker-${k}`,
      target_id: ME,
      created_at: new Date(BASE + minute * 60_000),
      revealed: k === 30 || k === 29 || k === 3,
      responded: false,
    });
  }
  // Answered already, and a like on someone else: never listed, never counted
  likes.push({ id: uuid(200), actor_id: 'liker-old', target_id: ME, created_at: new Date(BASE), revealed: true, responded: true });
  likes.push({ id: uuid(201), actor_id: 'liker-x', target_id: 'someone-else', created_at: new Date(BASE), revealed: false, responded: false });
}

// ─── App ──────────────────────────────────────────────────────────

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
  seedConversations();
  seedLikes();
  premiumUsers = new Set([ME]);
  mockQuery.mockClear();
});

function get(path: string, params: Record<string, string> = {}) {
  const qs = new URLSearchParams(params).toString();
  return app.inject({
    method: 'GET',
    url: `/api/v1/matches/${path}${qs ? `?${qs}` : ''}`,
    headers: { authorization: `Bearer ${app.jwt.sign({ sub: ME })}` },
  });
}

const matchIds = (body: any): string[] => body.data.conversations.map((c: any) => c.matchId);
const likerIds = (body: any): string[] => body.data.likes.map((l: any) => l.userId);
const range = (from: number, to: number): string[] =>
  Array.from({ length: from - to + 1 }, (_, i) => uuid(from - i));

// ─── Tests ────────────────────────────────────────────────────────

describe('GET /matches/conversations', () => {
  it('walks the list in pages, exactly, across a shared timestamp and into the matches without messages', async () => {
    const first = (await get('conversations', { limit: '3' })).json();
    expect(matchIds(first)).toEqual([uuid(7), uuid(6), uuid(5)]);
    expect(first.data.nextCursor).toEqual(expect.any(String));
    // First page only: every active match, and those with something unread
    expect(first.data.matchIds.sort()).toEqual(range(7, 1).sort());
    expect(first.data.unreadMatchIds.sort()).toEqual([uuid(4), uuid(7)]);

    const second = (await get('conversations', { limit: '3', cursor: first.data.nextCursor })).json();
    expect(matchIds(second)).toEqual([uuid(4), uuid(3), uuid(2)]);
    expect(second.data.matchIds).toBeUndefined();
    expect(second.data.unreadMatchIds).toBeUndefined();

    const third = (await get('conversations', { limit: '3', cursor: second.data.nextCursor })).json();
    expect(matchIds(third)).toEqual([uuid(1)]);
    expect(third.data.nextCursor).toBeNull();

    // Two database round trips for the first page (rows and the id sync),
    // one for each later page
    expect(mockQuery).toHaveBeenCalledTimes(4);
  });

  it('does not repeat a chat that moved to the top after its page was shown', async () => {
    const first = (await get('conversations', { limit: '3' })).json();
    expect(matchIds(first)).toEqual([uuid(7), uuid(6), uuid(5)]);

    // m5 gets a new message: it is now the most recent of all
    messages.push({ match_id: uuid(5), sender_id: 'partner-5', created_at: new Date(BASE + 5000 * 60_000), read_at: null });

    const second = (await get('conversations', { limit: '3', cursor: first.data.nextCursor })).json();
    expect(matchIds(second)).toEqual([uuid(4), uuid(3), uuid(2)]);
  });

  it('keeps the newest page small and the default within bounds', async () => {
    expect(matchIds((await get('conversations', { limit: '0' })).json())).toHaveLength(1);
    const all = (await get('conversations')).json();
    expect(matchIds(all)).toEqual(range(7, 1));
    expect(all.data.nextCursor).toBeNull();
  });

  it('rejects a cursor it did not produce', async () => {
    expect((await get('conversations', { cursor: 'not-a-cursor' })).statusCode).toBe(400);
    const likesCursor = Buffer.from('2026-01-01 00:00:00.000000+00|' + uuid(1)).toString('base64url');
    expect((await get('conversations', { cursor: likesCursor })).statusCode).toBe(400);
  });
});

describe('GET /matches/likes', () => {
  it('pages a Premium account through everyone, newest first, exactly across a shared timestamp', async () => {
    const first = (await get('likes')).json();
    expect(first.data.locked).toBe(false);
    expect(first.data.totalCount).toBe(30);
    expect(likerIds(first)).toEqual(Array.from({ length: 25 }, (_, i) => `liker-${30 - i}`));
    expect(first.data.nextCursor).toEqual(expect.any(String));

    const second = (await get('likes', { cursor: first.data.nextCursor })).json();
    expect(likerIds(second)).toEqual(['liker-5', 'liker-4', 'liker-3', 'liker-2', 'liker-1']);
    expect(second.data.nextCursor).toBeNull();
    expect(second.data.totalCount).toBeUndefined();
  });

  it('gives a free account its revealed likes, the full count, and no further page', async () => {
    premiumUsers.clear();
    const body = (await get('likes')).json();
    expect(body.data.locked).toBe(true);
    expect(likerIds(body)).toEqual(['liker-30', 'liker-29', 'liker-3']);
    expect(body.data.totalCount).toBe(30);
    expect(body.data.nextCursor).toBeNull();
  });

  it('rejects a cursor it did not produce', async () => {
    expect((await get('likes', { cursor: 'nope' })).statusCode).toBe(400);
    const conversationsCursor = Buffer.from('1|2026-01-01 00:00:00.000000+00|' + uuid(1)).toString('base64url');
    expect((await get('likes', { cursor: conversationsCursor })).statusCode).toBe(400);
  });
});
