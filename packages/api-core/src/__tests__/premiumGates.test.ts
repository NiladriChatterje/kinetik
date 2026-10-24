import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import jwt from '@fastify/jwt';
import { encryptMessage } from '@kinetik/shared';

// ─── Server-side Premium gates ──────────────────────────────────────
// Drives the real match routes over HTTP against an in-memory database, so
// the checks are the ones a hand-crafted API call would hit: who liked you
// is a count only for free users, and a free user can use only their oldest
// active chat (services/premiumAccess.ts).

const FREE = 'user-free';
const PREMIUM = 'user-premium';
const EXPIRED = 'user-expired';
const NO_EXPIRY = 'user-no-expiry';
const PARTNER_1 = 'user-partner-1';
const PARTNER_2 = 'user-partner-2';

const DAY = 24 * 3600 * 1000;

interface LedgerRow { tier: string; expires_at: Date | null }
interface MatchRow { id: string; user_a_id: string; user_b_id: string; matched_at: Date; is_active: boolean }

let ledger: Map<string, LedgerRow>;
let matches: MatchRow[];
let likers: { actor_id: string; target_id: string; revealed?: boolean; responded?: boolean }[];
// users.free_likes_revealed per target (migration 025)
let freeLikesRevealed: Map<string, number>;
let sqlLog: string[];

const isPremium = (userId: string) => {
  const row = ledger.get(userId);
  return Boolean(
    row &&
    ['premium', 'infinite'].includes(row.tier) &&
    row.expires_at &&
    row.expires_at.getTime() > Date.now() - 6 * 3600 * 1000,
  );
};

const mockQuery = vi.fn(async (sql: string, params: any[] = []) => {
  const text = sql.replace(/\s+/g, ' ');
  sqlLog.push(text);

  if (text.includes("tier IN ('premium', 'infinite')")) {
    return isPremium(params[0]) ? { rows: [{}], rowCount: 1 } : { rows: [], rowCount: 0 };
  }
  if (text.includes('SELECT free_chat_match_id, free_chat_spent FROM users')) {
    // The user row records the first match; spent once that match ended
    const own = matches
      .filter((m) => m.user_a_id === params[0] || m.user_b_id === params[0])
      .sort((a, b) => a.matched_at.getTime() - b.matched_at.getTime() || a.id.localeCompare(b.id));
    return {
      rows: [{ free_chat_match_id: own[0]?.id ?? null, free_chat_spent: own[0] ? !own[0].is_active : false }],
      rowCount: 1,
    };
  }
  if (/FROM matches WHERE id = \$1 AND \(user_a_id = \$2 OR user_b_id = \$2\) AND is_active = TRUE/.test(text)) {
    const m = matches.find((r) => r.id === params[0] && r.is_active && (r.user_a_id === params[1] || r.user_b_id === params[1]));
    return { rows: m ? [m] : [], rowCount: m ? 1 : 0 };
  }
  if (text.includes('COUNT(*)::int AS cnt FROM (')) {
    return { rows: [{ cnt: likers.filter((l) => l.target_id === params[0]).length }], rowCount: 1 };
  }
  if (text.startsWith('WITH slots AS')) {
    // The reveal statement: newest-first (later fixture entries are newer),
    // only while lifetime reveals remain
    const target = params[0];
    const used = freeLikesRevealed.get(target) ?? 0;
    const slots = Math.max(0, params[1] - used);
    const pick = likers
      .filter((l) => l.target_id === target && !l.revealed && !l.responded)
      .slice()
      .reverse()
      .slice(0, slots);
    pick.forEach((l) => { l.revealed = true; });
    freeLikesRevealed.set(target, used + pick.length);
    return { rows: [], rowCount: 1 };
  }
  if (text.includes('AS pending_count FROM user_interactions')) {
    const cnt = likers.filter((l) => l.target_id === params[0] && !l.responded).length;
    return { rows: [{ pending_count: cnt }], rowCount: 1 };
  }
  if (text.includes('FROM user_interactions ui JOIN users u ON u.id = ui.actor_id')) {
    // Newest first (later fixture entries are newer); a free account ($2
    // false) is sent only the likes it has revealed
    const rows = likers
      .filter((l) => l.target_id === params[0] && !l.responded && (params[1] || l.revealed))
      .slice()
      .reverse()
      .slice(0, params[2])
      .map((l) => ({
        user_id: l.actor_id,
        display_name: `Name of ${l.actor_id}`,
        action: 'like',
        revealed_at: l.revealed ? new Date() : null,
        like_id: `like-${l.actor_id}`,
        liked_at_text: '2026-01-01 00:00:00.000000+00',
      }));
    return { rows, rowCount: rows.length };
  }
  if (text.includes(') AS unread FROM matches m')) {
    const rows = matches
      .filter((m) => m.is_active && (m.user_a_id === params[0] || m.user_b_id === params[0]))
      .map((m) => ({ id: m.id, unread: true }));
    return { rows, rowCount: rows.length };
  }
  if (text.includes('m.id as match_id')) {
    const rows = matches
      .filter((m) => m.is_active && (m.user_a_id === params[0] || m.user_b_id === params[0]))
      .map((m) => ({
        match_id: m.id,
        partner_id: m.user_a_id === params[0] ? m.user_b_id : m.user_a_id,
        partner_name: 'Partner',
        is_active: true,
        last_message_content: encryptMessage(`secret in ${m.id}`, ''),
        last_message_at: new Date(),
        last_message_sender_id: m.user_a_id === params[0] ? m.user_b_id : m.user_a_id,
        unread_count: 1,
      }));
    return { rows, rowCount: rows.length };
  }
  if (text.includes('LEFT JOIN chat_media cm ON cm.message_id = m.id')) {
    return { rows: [{ id: 'msg-1', match_id: params[0], sender_id: PARTNER_1, content: encryptMessage('hi', ''), created_at: new Date() }], rowCount: 1 };
  }
  if (text.startsWith('UPDATE messages SET read_at')) return { rows: [], rowCount: 0 };
  if (text.startsWith('INSERT INTO messages')) {
    return { rows: [{ id: 'msg-new', match_id: params[0], sender_id: params[1], created_at: new Date(), read_at: null }], rowCount: 1 };
  }
  if (text.startsWith('SELECT display_name FROM users')) return { rows: [{ display_name: 'Sender' }], rowCount: 1 };
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

vi.mock('../services/eventBus', () => ({
  eventBus: { publish: vi.fn().mockResolvedValue(undefined) },
}));

const mockNewMessage = vi.fn().mockResolvedValue(undefined);
vi.mock('../services/notificationService', () => ({
  notificationEvents: {
    newMessage: mockNewMessage,
    newMatch: vi.fn().mockResolvedValue(undefined),
    newLike: vi.fn().mockResolvedValue(undefined),
  },
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
  vi.clearAllMocks();
  sqlLog = [];
  const inAMonth = new Date(Date.now() + 30 * DAY);
  ledger = new Map([
    [FREE, { tier: 'free', expires_at: null }],
    [PREMIUM, { tier: 'premium', expires_at: inAMonth }],
    [EXPIRED, { tier: 'premium', expires_at: new Date(Date.now() - 2 * DAY) }],
    // A paid tier with no Play expiry was never bought through Play
    [NO_EXPIRY, { tier: 'premium', expires_at: null }],
  ]);
  matches = [];
  for (const user of [FREE, PREMIUM, EXPIRED, NO_EXPIRY]) {
    // match-<user>-old is each user's first match: their free chat
    matches.push({ id: `match-${user}-old`, user_a_id: user, user_b_id: PARTNER_1, matched_at: new Date(Date.now() - 10 * DAY), is_active: true });
    matches.push({ id: `match-${user}-new`, user_a_id: PARTNER_2, user_b_id: user, matched_at: new Date(Date.now() - DAY), is_active: true });
  }
  freeLikesRevealed = new Map();
  likers = [FREE, PREMIUM, EXPIRED, NO_EXPIRY].flatMap((target) => [
    { actor_id: PARTNER_1, target_id: target },
    { actor_id: PARTNER_2, target_id: target },
  ]);
});

const call = (method: 'GET' | 'POST', userId: string, url: string, payload?: object) =>
  app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${app.jwt.sign({ sub: userId })}` },
    payload,
  });

describe('who liked you', () => {
  it('reveals at most five likers to a free user, for life', async () => {
    // Two likes: both within the free allowance
    let res = await call('GET', FREE, '/api/v1/matches/likes');
    expect(res.statusCode).toBe(200);
    let data = res.json().data;
    expect(data.locked).toBe(true);
    expect(data.totalCount).toBe(2);
    expect(data.likes.map((l: any) => l.userId).sort()).toEqual([PARTNER_1, PARTNER_2]);

    // Seven likes: five revealed (the two already shown plus the newest
    // three), two only counted
    for (let i = 0; i < 5; i++) likers.push({ actor_id: `extra-${i}`, target_id: FREE });
    res = await call('GET', FREE, '/api/v1/matches/likes');
    data = res.json().data;
    expect(data.totalCount).toBe(7);
    expect(data.likes).toHaveLength(5);
    const shown = data.likes.map((l: any) => l.userId);
    expect(shown).toEqual(expect.arrayContaining([PARTNER_1, PARTNER_2, 'extra-4', 'extra-3', 'extra-2']));

    // Rejecting a revealed liker does not free the slot: four remain
    // visible, the hidden two stay hidden
    likers.find((l) => l.actor_id === PARTNER_1 && l.target_id === FREE)!.responded = true;
    res = await call('GET', FREE, '/api/v1/matches/likes');
    data = res.json().data;
    expect(data.totalCount).toBe(6);
    expect(data.likes).toHaveLength(4);
    expect(data.likes.map((l: any) => l.userId)).not.toContain('extra-0');
    expect(data.likes.map((l: any) => l.userId)).not.toContain('extra-1');

    // A new like arriving now is counted but not shown either
    likers.push({ actor_id: 'extra-new', target_id: FREE });
    res = await call('GET', FREE, '/api/v1/matches/likes');
    data = res.json().data;
    expect(data.totalCount).toBe(7);
    expect(data.likes).toHaveLength(4);
  });

  it('gives a Premium user the full list', async () => {
    const res = await call('GET', PREMIUM, '/api/v1/matches/likes');
    const data = res.json().data;
    expect(data.locked).toBe(false);
    expect(data.likes.map((l: any) => l.userId).sort()).toEqual([PARTNER_1, PARTNER_2]);
  });

  it('treats a Premium row past its Play expiry as free', async () => {
    const res = await call('GET', EXPIRED, '/api/v1/matches/likes');
    expect(res.json().data.locked).toBe(true);
  });

  it('treats a paid tier with no Play expiry as free', async () => {
    const res = await call('GET', NO_EXPIRY, '/api/v1/matches/likes');
    expect(res.json().data.locked).toBe(true);
  });
});

describe('chat lock', () => {
  it('refuses a free user reading even their oldest chat', async () => {
    const res = await call('GET', FREE, `/api/v1/matches/conversations/match-${FREE}-old/messages`);
    expect(res.statusCode).toBe(402);
    expect(res.json().error.code).toBe('CHAT_LOCKED');
  });

  it('refuses a free user reading any other chat, without marking it read', async () => {
    const res = await call('GET', FREE, `/api/v1/matches/conversations/match-${FREE}-new/messages`);
    expect(res.statusCode).toBe(402);
    expect(res.json().error.code).toBe('CHAT_LOCKED');
    expect(res.body).not.toContain('"messages"');
    expect(sqlLog.some((s) => s.startsWith('UPDATE messages SET read_at'))).toBe(false);
  });

  it('keeps every chat locked once the free chat has been unmatched', async () => {
    // Unmatching the first match must not promote the next one to free, or a
    // free user could chat with everyone one at a time.
    matches.find((m) => m.id === `match-${FREE}-old`)!.is_active = false;
    const res = await call('GET', FREE, `/api/v1/matches/conversations/match-${FREE}-new/messages`);
    expect(res.statusCode).toBe(402);
    expect(res.json().error.code).toBe('CHAT_LOCKED');
  });

  it('refuses a free user sending in a locked chat, without storing it', async () => {
    const res = await call('POST', FREE, `/api/v1/matches/conversations/match-${FREE}-new/messages`, { content: 'hello' });
    expect(res.statusCode).toBe(402);
    expect(sqlLog.some((s) => s.startsWith('INSERT INTO messages'))).toBe(false);
  });

  it('lets a Premium user read and send in every chat', async () => {
    const read = await call('GET', PREMIUM, `/api/v1/matches/conversations/match-${PREMIUM}-new/messages`);
    expect(read.statusCode).toBe(200);
    const send = await call('POST', PREMIUM, `/api/v1/matches/conversations/match-${PREMIUM}-new/messages`, { content: 'hello' });
    expect(send.statusCode).toBe(201);
  });

  it('locks chats again once Premium has expired', async () => {
    const res = await call('GET', EXPIRED, `/api/v1/matches/conversations/match-${EXPIRED}-new/messages`);
    expect(res.statusCode).toBe(402);
  });

  it('lists locked chats without their message text', async () => {
    const res = await call('GET', FREE, '/api/v1/matches/conversations');
    const convs = res.json().data.conversations;
    const open = convs.find((c: any) => c.matchId === `match-${FREE}-old`);
    const locked = convs.find((c: any) => c.matchId === `match-${FREE}-new`);
    // Chat is Premium only: every conversation of a free account is locked
    expect(open.locked).toBe(true);
    expect(open.lastMessage).toBeUndefined();
    expect(locked.locked).toBe(true);
    expect(locked.lastMessage).toBeUndefined();
    expect(res.body).not.toContain(`secret in match-${FREE}-old`);
    expect(res.body).not.toContain(`secret in match-${FREE}-new`);
  });

  it('sends no message text in the push to a partner whose side is locked', async () => {
    // FREE is the partner here: the chat is their newer one, so locked for
    // them. The sender has Premium, so their own side is open.
    ledger.set(PARTNER_2, { tier: 'premium', expires_at: new Date(Date.now() + 30 * DAY) });
    const send = await call('POST', PARTNER_2, `/api/v1/matches/conversations/match-${FREE}-new/messages`, { content: 'private words' });
    expect(send.statusCode).toBe(201);
    expect(JSON.stringify(mockNewMessage.mock.calls[0])).not.toContain('private words');
  });
});
