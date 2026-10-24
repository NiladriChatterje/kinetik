import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import jwt from '@fastify/jwt';

// ─── In-app reporting and blocking ──────────────────────────────────
// Drives the real safety routes, and the like paths in the match routes,
// over HTTP against a small in-memory database, so the checks are the ones a
// hand-crafted API call would hit.

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const STRANGER = '33333333-3333-4333-8333-333333333333';
const MISSING = '44444444-4444-4444-8444-444444444444';
const MATCH_ME_OTHER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MATCH_OTHERS = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

interface Interaction { actor_id: string; target_id: string; action: string; is_mutual: boolean; responded_at: Date | null }
interface Match { id: string; user_a_id: string; user_b_id: string; is_active: boolean }
interface Report { id: string; reporter_id: string; reported_id: string; match_id: string | null; reason: string; details: string | null; status: string }

let users: Map<string, { id: string; display_name: string }>;
let matches: Match[];
let interactions: Interaction[];
let blocks: Array<{ blocker_id: string; blocked_id: string }>;
let reports: Report[];
let reportSeq = 0;
let messagesDeleted: string[];

const pair = (a: string, b: string, x: string, y: string) => (a === x && b === y) || (a === y && b === x);

// A tiny SQL dispatcher: each statement the routes send is recognised by its
// text and applied to the arrays above.
function runQuery(text: string, params: any[] = []): { rows: any[]; rowCount: number } {
  const sql = text.replace(/\s+/g, ' ');
  const out = (rows: any[]) => ({ rows, rowCount: rows.length });

  if (sql.includes('FROM user_reports WHERE (reporter_id = $1 AND reported_id = $2) OR')) {
    const [a, b] = params;
    return out(reports.filter((r) => pair(r.reporter_id, r.reported_id, a, b)).map(() => ({ '?column?': 1 })));
  }
  if (sql.startsWith('SELECT id, user_a_id, user_b_id FROM matches WHERE id = $1')) {
    const [id, user] = params;
    return out(matches.filter((m) => m.id === id && m.is_active && (m.user_a_id === user || m.user_b_id === user)));
  }
  if (sql.startsWith('DELETE FROM messages WHERE match_id = $1')) {
    messagesDeleted.push(params[0]);
    return out([]);
  }
  if (sql.startsWith('UPDATE matches SET is_active = FALSE WHERE id = $1')) {
    matches.filter((m) => m.id === params[0]).forEach((m) => { m.is_active = false; });
    return out([]);
  }
  if (sql.includes('FROM user_blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR')) {
    const [a, b] = params;
    return out(blocks.filter((r) => pair(r.blocker_id, r.blocked_id, a, b)).map(() => ({ '?column?': 1 })));
  }
  if (sql.startsWith('SELECT id, display_name FROM users WHERE id = $1') || sql.startsWith('SELECT id FROM users WHERE id = $1')) {
    const u = users.get(params[0]);
    return out(u ? [u] : []);
  }
  if (sql.startsWith('SELECT id FROM matches WHERE id = $1')) {
    const [id, a, b] = params;
    return out(matches.filter((m) => m.id === id && pair(m.user_a_id, m.user_b_id, a, b)).map((m) => ({ id: m.id })));
  }
  if (sql.startsWith('WITH prior AS')) {
    const [reporter, reported, matchId, reason, details] = params;
    const existing = reports.find((r) => r.reporter_id === reporter && r.reported_id === reported);
    const prior = existing ? existing.reason : null;
    if (existing) {
      Object.assign(existing, { reason, details, match_id: matchId ?? existing.match_id, status: 'open' });
      return out([{ id: existing.id, prior_reason: prior }]);
    }
    const id = `0000000${++reportSeq}-0000-4000-8000-000000000000`;
    reports.push({ id, reporter_id: reporter, reported_id: reported, match_id: matchId, reason, details, status: 'open' });
    return out([{ id, prior_reason: null }]);
  }
  if (sql.startsWith('SELECT id FROM user_interactions WHERE actor_id = $1 AND target_id = $2 AND action IN')) {
    const [actor, target] = params;
    return out(interactions
      .filter((i) => i.actor_id === actor && i.target_id === target && !i.is_mutual && ['like', 'super_like'].includes(i.action))
      .map(() => ({ id: 'interaction' })));
  }
  if (sql.startsWith('INSERT INTO user_blocks')) {
    const [blocker, blocked] = params;
    if (!blocks.some((r) => r.blocker_id === blocker && r.blocked_id === blocked)) blocks.push({ blocker_id: blocker, blocked_id: blocked });
    return out([]);
  }
  if (sql.startsWith('UPDATE matches SET is_active = FALSE WHERE is_active = TRUE')) {
    const [a, b] = params;
    const ended = matches.filter((m) => m.is_active && pair(m.user_a_id, m.user_b_id, a, b));
    ended.forEach((m) => { m.is_active = false; });
    return out(ended.map((m) => ({ id: m.id })));
  }
  if (sql.startsWith('UPDATE user_interactions SET responded_at = NOW() WHERE ((actor_id = $1')) {
    const [a, b] = params;
    const hit = interactions.filter((i) => pair(i.actor_id, i.target_id, a, b) && !i.is_mutual && i.responded_at === null);
    hit.forEach((i) => { i.responded_at = new Date(); });
    return out([]);
  }
  // Anything else (free-chat bookkeeping, unrelated reads) is a no-op here
  return out([]);
}

const mockQuery = vi.fn(async (text: string, params?: any[]) => runQuery(text, params));
const mockSendReportEmail = vi.fn().mockResolvedValue(true);
const mockPublish = vi.fn().mockResolvedValue(undefined);

vi.mock('@kinetik/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@kinetik/shared')>();
  return { ...actual, transaction: async (cb: any) => cb(mockQuery) };
});

vi.mock('../services/database', () => ({
  query: mockQuery,
  TABLES: {
    USERS: 'users',
    MATCHES: 'matches',
    MESSAGES: 'messages',
    USER_INTERACTIONS: 'user_interactions',
    USER_BLOCKS: 'user_blocks',
    USER_REPORTS: 'user_reports',
    PROFILE_PHOTOS: 'profile_photos',
    USER_PREFERENCES: 'user_preferences',
    USER_INTERESTS: 'user_interests',
    INTERESTS: 'interests',
    SUBSCRIPTION_LEDGER: 'subscription_ledger',
    CHAT_MEDIA: 'chat_media',
  },
}));

vi.mock('../services/email', () => ({ sendSafetyReportEmail: mockSendReportEmail }));

vi.mock('../services/redis', () => ({
  getRedis: () => ({ publish: vi.fn(), get: vi.fn(), set: vi.fn(), del: vi.fn(), status: 'end' }),
  publishChatMessage: mockPublish,
}));

vi.mock('../services/eventBus', () => ({
  eventBus: { sendUserEvent: vi.fn(), sendMatchEvent: vi.fn(), publish: vi.fn() },
}));

vi.mock('../services/notificationService', () => ({
  notificationEvents: { newMessage: vi.fn(), newMatch: vi.fn(), newLike: vi.fn() },
}));

vi.mock('../services/photoStorage', () => ({
  savePhoto: vi.fn(),
  saveEncryptedChatFile: vi.fn(),
  getEncryptedChatFileBuffer: vi.fn(),
  deleteChatFile: vi.fn(),
}));

let app: FastifyInstance;

beforeAll(async () => {
  const { safetyRoutes } = await import('../routes/safety');
  const { matchRoutes } = await import('../routes/matches');
  app = Fastify();
  await app.register(jwt, { secret: 'test-secret' });
  await app.register(safetyRoutes, { prefix: '/api/v1/safety' });
  await app.register(matchRoutes, { prefix: '/api/v1/matches' });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  users = new Map([
    [ME, { id: ME, display_name: 'Me' }],
    [OTHER, { id: OTHER, display_name: 'Other' }],
    [STRANGER, { id: STRANGER, display_name: 'Stranger' }],
  ]);
  matches = [
    { id: MATCH_ME_OTHER, user_a_id: ME, user_b_id: OTHER, is_active: true },
    { id: MATCH_OTHERS, user_a_id: OTHER, user_b_id: STRANGER, is_active: true },
  ];
  interactions = [];
  blocks = [];
  reports = [];
  messagesDeleted = [];
});

const post = (url: string, payload: unknown, userId = ME) =>
  app.inject({
    method: 'POST',
    url,
    payload: payload as any,
    headers: { authorization: `Bearer ${app.jwt.sign({ sub: userId })}` },
  });

describe('POST /safety/report', () => {
  it('requires a login', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/safety/report', payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a missing user id, an unknown reason, and reporting yourself', async () => {
    expect((await post('/api/v1/safety/report', { reason: 'scam' })).statusCode).toBe(400);
    expect((await post('/api/v1/safety/report', { reportedUserId: OTHER, reason: 'rude' })).statusCode).toBe(400);
    expect((await post('/api/v1/safety/report', { reportedUserId: ME, reason: 'scam' })).statusCode).toBe(400);
    expect(reports).toHaveLength(0);
  });

  it('answers 404 for a user that does not exist', async () => {
    const res = await post('/api/v1/safety/report', { reportedUserId: MISSING, reason: 'scam' });
    expect(res.statusCode).toBe(404);
  });

  it('stores a report and emails it, marked urgent for child safety', async () => {
    const res = await post('/api/v1/safety/report', {
      reportedUserId: OTHER, reason: 'child_safety', details: '  looks under 18  ', matchId: MATCH_ME_OTHER,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.reportId).toBe(reports[0].id);
    expect(reports[0]).toMatchObject({ reporter_id: ME, reported_id: OTHER, reason: 'child_safety', details: 'looks under 18', match_id: MATCH_ME_OTHER });
    expect(mockSendReportEmail).toHaveBeenCalledTimes(1);
    expect(mockSendReportEmail.mock.calls[0][0]).toMatchObject({ reason: 'child_safety', urgent: true, reportedName: 'Other' });
  });

  it('keeps a match id only when the match is between the two people', async () => {
    await post('/api/v1/safety/report', { reportedUserId: STRANGER, reason: 'scam', matchId: MATCH_OTHERS });
    expect(reports[0].match_id).toBeNull();
  });

  it('updates a repeat report and emails again only when the reason changes', async () => {
    await post('/api/v1/safety/report', { reportedUserId: OTHER, reason: 'scam' });
    await post('/api/v1/safety/report', { reportedUserId: OTHER, reason: 'scam', details: 'again' });
    expect(reports).toHaveLength(1);
    expect(mockSendReportEmail).toHaveBeenCalledTimes(1);
    await post('/api/v1/safety/report', { reportedUserId: OTHER, reason: 'underage' });
    expect(reports).toHaveLength(1);
    expect(reports[0].reason).toBe('underage');
    expect(mockSendReportEmail).toHaveBeenCalledTimes(2);
    expect(mockSendReportEmail.mock.calls[1][0].urgent).toBe(true);
  });

  it('caps details at 1000 characters', async () => {
    await post('/api/v1/safety/report', { reportedUserId: OTHER, reason: 'other', details: 'x'.repeat(5000) });
    expect(reports[0].details).toHaveLength(1000);
  });
});

describe('POST /safety/block', () => {
  it('rejects a missing user id and blocking yourself, and 404s an unknown user', async () => {
    expect((await post('/api/v1/safety/block', {})).statusCode).toBe(400);
    expect((await post('/api/v1/safety/block', { userId: ME })).statusCode).toBe(400);
    expect((await post('/api/v1/safety/block', { userId: MISSING })).statusCode).toBe(404);
    expect(blocks).toHaveLength(0);
  });

  it('records the block, ends only their chat, and tells both apps', async () => {
    const res = await post('/api/v1/safety/block', { userId: OTHER });
    expect(res.statusCode).toBe(200);
    expect(blocks).toEqual([{ blocker_id: ME, blocked_id: OTHER }]);
    expect(matches.find((m) => m.id === MATCH_ME_OTHER)!.is_active).toBe(false);
    expect(matches.find((m) => m.id === MATCH_OTHERS)!.is_active).toBe(true);
    expect(mockPublish).toHaveBeenCalledTimes(1);
    expect(mockPublish.mock.calls[0][1]).toEqual({ type: 'match:unmatched', matchId: MATCH_ME_OTHER, unmatchedByUserId: ME });
  });

  it('closes pending likes either way but leaves other people\'s likes alone', async () => {
    interactions = [
      { actor_id: OTHER, target_id: ME, action: 'like', is_mutual: false, responded_at: null },
      { actor_id: ME, target_id: OTHER, action: 'super_like', is_mutual: false, responded_at: null },
      { actor_id: STRANGER, target_id: ME, action: 'like', is_mutual: false, responded_at: null },
    ];
    matches = [];
    await post('/api/v1/safety/block', { userId: OTHER });
    expect(interactions[0].responded_at).not.toBeNull();
    expect(interactions[1].responded_at).not.toBeNull();
    expect(interactions[2].responded_at).toBeNull();
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it('is safe to repeat', async () => {
    await post('/api/v1/safety/block', { userId: OTHER });
    const again = await post('/api/v1/safety/block', { userId: OTHER });
    expect(again.statusCode).toBe(200);
    expect(blocks).toHaveLength(1);
  });
});

describe('likes between a blocked pair', () => {
  it('refuses a swipe from either side', async () => {
    blocks = [{ blocker_id: ME, blocked_id: OTHER }];
    const mine = await post('/api/v1/matches/swipe', { targetUserId: OTHER, action: 'like' }, ME);
    const theirs = await post('/api/v1/matches/swipe', { targetUserId: ME, action: 'like' }, OTHER);
    expect(mine.statusCode).toBe(404);
    expect(theirs.statusCode).toBe(404);
  });

  it('refuses a like-back, even though a closed like still exists', async () => {
    blocks = [{ blocker_id: OTHER, blocked_id: ME }];
    interactions = [{ actor_id: OTHER, target_id: ME, action: 'like', is_mutual: false, responded_at: new Date() }];
    const res = await post('/api/v1/matches/respond', { targetUserId: OTHER, action: 'like' }, ME);
    expect(res.statusCode).toBe(404);
  });

  it('lets an unblocked pair through to the normal swipe checks', async () => {
    const res = await post('/api/v1/matches/swipe', { targetUserId: STRANGER, action: 'like' }, ME);
    expect(res.statusCode).not.toBe(404);
  });
});

describe('unmatching a reported chat', () => {
  const unmatch = (userId = ME) =>
    app.inject({
      method: 'DELETE',
      url: `/api/v1/matches/conversations/${MATCH_ME_OTHER}`,
      headers: { authorization: `Bearer ${app.jwt.sign({ sub: userId })}` },
    });

  it('deletes the messages when nobody reported anyone', async () => {
    const res = await unmatch();
    expect(res.statusCode).toBe(200);
    expect(messagesDeleted).toEqual([MATCH_ME_OTHER]);
    expect(matches.find((m) => m.id === MATCH_ME_OTHER)!.is_active).toBe(false);
  });

  it('keeps the messages, but still ends the chat, when either person reported the other', async () => {
    reports = [{ id: 'r', reporter_id: OTHER, reported_id: ME, match_id: null, reason: 'harassment', details: null, status: 'open' }];
    const res = await unmatch(ME);
    expect(res.statusCode).toBe(200);
    expect(messagesDeleted).toEqual([]);
    expect(matches.find((m) => m.id === MATCH_ME_OTHER)!.is_active).toBe(false);
    expect(mockPublish.mock.calls.some((c) => c[1]?.type === 'match:unmatched')).toBe(true);
  });
});
