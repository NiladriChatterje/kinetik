import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import jwt from '@fastify/jwt';
import crypto from 'crypto';

// ─── Why this test exists ──────────────────────────────────────────
// Seen live on 2026-10-19: the database was waking up, the app's first
// /auth/refresh took 27 s, the app retried with the same refresh token, and
// the second request lost the rotation race and answered 401. The app read
// that as "session expired" and signed the user out. A signed-in user must
// stay signed in through anything the server does to itself; the only
// refusals left are tokens that were never issued, expired, or replayed
// after the device demonstrably received the successor.

// ─── In-memory refresh_tokens table behind the mocked query() ─────
interface Row {
  user_id: string;
  token_hash: string;
  family_id: string;
  created_at: Date;
  revoked_at: Date | null;
  expires_at: Date;
}
const table: Row[] = [];
let dbDown = false;
let tick = 0; // keeps created_at strictly increasing (whole ms: Date has no finer precision)

const sql = (s: string) => s.replace(/\s+/g, ' ').trim();

const mockQuery = vi.fn(async (text: string, params: any[] = []) => {
  if (dbDown) throw new Error('connect ETIMEDOUT (database waking up)');
  const q = sql(text);

  if (q.startsWith('INSERT INTO refresh_tokens')) {
    table.push({
      user_id: params[0],
      token_hash: params[1],
      family_id: params[2],
      created_at: new Date(Date.now() + tick++),
      revoked_at: null,
      expires_at: params[3],
    });
    return { rows: [] };
  }
  if (q.startsWith('SELECT user_id, family_id, revoked_at, expires_at, created_at FROM refresh_tokens WHERE token_hash')) {
    const row = table.find((r) => r.token_hash === params[0]);
    return { rows: row ? [{ ...row }] : [] };
  }
  if (q.startsWith('SELECT 1 FROM refresh_tokens WHERE family_id') && q.includes('revoked_at IS NOT NULL')) {
    const now = new Date();
    const hit = table.find(
      (r) => r.family_id === params[0] && r.created_at > params[1] && r.revoked_at !== null && r.expires_at > now,
    );
    return { rows: hit ? [{ '?column?': 1 }] : [] };
  }
  // killTokens: revoke AND expire, with one of three WHERE shapes
  if (q.startsWith('UPDATE refresh_tokens SET revoked_at = NOW(), expires_at = NOW() WHERE')) {
    const now = new Date();
    for (const r of table) {
      if (r.revoked_at !== null) continue;
      const match = q.includes('created_at >')
        ? r.family_id === params[0] && r.created_at > params[1]
        : q.includes('family_id')
          ? r.family_id === params[0]
          : r.user_id === params[0];
      if (match) {
        r.revoked_at = now;
        r.expires_at = now;
      }
    }
    return { rows: [] };
  }
  // rotation: revoke only
  if (q.startsWith('UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash')) {
    const row = table.find((r) => r.token_hash === params[0] && r.revoked_at === null);
    if (!row) return { rows: [] };
    row.revoked_at = new Date();
    return { rows: [{ user_id: row.user_id, family_id: row.family_id }] };
  }
  throw new Error(`unexpected SQL in test: ${q}`);
});

const USER = { id: 'user-1', phone: null, email: 'a@b.c', is_active: true };

vi.mock('../services/database', () => ({
  query: mockQuery,
  createUser: vi.fn(),
  findUserByEmail: vi.fn(),
  findUserByPhone: vi.fn(),
  findUserById: vi.fn(async (id: string) => (id === USER.id ? USER : null)),
  createSubscription: vi.fn(),
  getSubscription: vi.fn().mockResolvedValue(null),
}));
vi.mock('../services/signupStore', () => ({
  SIGNUP_CODE_TTL_SECONDS: 300,
  SIGNUP_MAX_ATTEMPTS: 3,
  SIGNUP_MAX_SENDS_PER_DAY: 3,
  SIGNUP_RESEND_COOLDOWN_SECONDS: 30,
  claimSend: vi.fn(),
  refundSend: vi.fn(),
  lockSeconds: vi.fn(),
  savePending: vi.fn(),
  getPending: vi.fn(),
  recordAttempt: vi.fn(),
  deletePending: vi.fn(),
}));
vi.mock('../services/photoStorage', () => ({
  deleteAllUserPhotos: vi.fn(),
  deleteAllUserKycDocuments: vi.fn(),
  deleteChatFile: vi.fn(),
}));
vi.mock('../services/playBilling', () => ({
  isPlayBillingConfigured: () => false,
  cancelSubscription: vi.fn(),
}));
vi.mock('../services/premiumAccess', () => ({ invalidateFreeChatCache: vi.fn() }));
vi.mock('../services/eventBus', () => ({ eventBus: { sendUserEvent: vi.fn(), publish: vi.fn() } }));
vi.mock('../services/email', () => ({
  sendOtpEmail: vi.fn(),
  isEmailConfigured: () => false,
  maskEmail: (e: string) => e,
}));
vi.mock('../services/locations', () => ({ resolveCity: vi.fn() }));

// ─── App ───────────────────────────────────────────────────────────
let app: FastifyInstance;

beforeAll(async () => {
  const { authRoutes } = await import('../routes/auth');
  app = Fastify();
  await app.register(jwt, { secret: 'test-secret', sign: { expiresIn: '15m' } });
  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.UTC(2026, 9, 19, 8, 0, 0));
  table.length = 0;
  tick = 0;
  dbDown = false;
  mockQuery.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

const hash = (t: string) => crypto.createHash('sha256').update(t).digest('hex');
const advanceMinutes = (m: number) => vi.setSystemTime(Date.now() + m * 60 * 1000);

/** A device that signed in a while ago and holds `token`. */
function seedSession(token: string, family = 'fam-1') {
  table.push({
    user_id: USER.id,
    token_hash: hash(token),
    family_id: family,
    created_at: new Date(Date.now() + tick++),
    revoked_at: null,
    expires_at: new Date(Date.now() + 365 * 24 * 3600 * 1000),
  });
}

function refresh(refreshToken: string) {
  return app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken } });
}

const live = (token: string) => table.find((r) => r.token_hash === hash(token));

// ─── Tests ──────────────────────────────────────────────────────────

describe('refresh token rotation keeps the device signed in', () => {
  it('rotates: old token revoked, new one live in the same family', async () => {
    seedSession('A');
    const res = await refresh('A');
    expect(res.statusCode).toBe(200);
    const { token, refreshToken: B } = res.json().data;
    expect(token).toBeTypeOf('string');
    expect(live('A')!.revoked_at).not.toBeNull();
    expect(live(B)!.revoked_at).toBeNull();
    expect(live(B)!.family_id).toBe('fam-1');
  });

  it('two refreshes racing with the same token both succeed (the live 2026-10-19 failure)', async () => {
    seedSession('A');
    const [r1, r2] = await Promise.all([refresh('A'), refresh('A')]);
    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);
    const t1 = r1.json().data.refreshToken;
    const t2 = r2.json().data.refreshToken;
    expect(t1).not.toBe(t2);
    // Whichever answer the app keeps works next time
    expect((await refresh(t1)).statusCode).toBe(200);
    expect((await refresh(t2)).statusCode).toBe(200);
  });

  it('a retry within two minutes of rotation is honoured', async () => {
    seedSession('A');
    expect((await refresh('A')).statusCode).toBe(200);
    advanceMinutes(1);
    const again = await refresh('A');
    expect(again.statusCode).toBe(200);
  });

  it('a reuse long after rotation is honoured when the successor was never used, and retires it', async () => {
    seedSession('A');
    const B = (await refresh('A')).json().data.refreshToken;
    // The answer carrying B never reached the phone; hours later it tries A
    advanceMinutes(6 * 60);
    const res = await refresh('A');
    expect(res.statusCode).toBe(200);
    const C = res.json().data.refreshToken;
    expect(live(B)!.revoked_at).not.toBeNull();
    expect(live(C)!.revoked_at).toBeNull();
    expect(live(C)!.family_id).toBe('fam-1');
    // The lost token is dead for good, well after any grace
    advanceMinutes(10);
    expect((await refresh(B)).statusCode).toBe(401);
    // The phone carries on with C
    expect((await refresh(C)).statusCode).toBe(200);
  });

  it('a reuse after the successor WAS used is a replay: 401 and the family is revoked', async () => {
    seedSession('A');
    const B = (await refresh('A')).json().data.refreshToken;
    const C = (await refresh(B)).json().data.refreshToken; // the device clearly had B
    advanceMinutes(10);
    const replay = await refresh('A');
    expect(replay.statusCode).toBe(401);
    expect(replay.json().error.code).toBe('TOKEN_EXPIRED');
    expect(table.every((r) => r.family_id !== 'fam-1' || r.revoked_at !== null)).toBe(true);
    expect((await refresh(C)).statusCode).toBe(401);
  });

  it('an unknown token is refused', async () => {
    expect((await refresh('never-issued')).statusCode).toBe(401);
  });

  it('a database failure is 503, never 401', async () => {
    seedSession('A');
    dbDown = true;
    const res = await refresh('A');
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).not.toBe('UNAUTHORIZED');
    expect(res.json().error.code).not.toBe('TOKEN_EXPIRED');
    dbDown = false;
    expect((await refresh('A')).statusCode).toBe(200);
  });
});
