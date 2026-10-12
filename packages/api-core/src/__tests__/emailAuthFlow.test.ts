import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import jwt from '@fastify/jwt';

// ─── Mocks ────────────────────────────────────────────────────────
// Everything behind the auth routes is mocked except bcrypt, so this drives
// the real wiring a new user goes through:
// sign-up form → emailed code → verify → account + session → password login.
// The otp-store Redis is replaced by an in-memory copy with the same rules
// (TTLs on the clock, atomic counters), so expiry and the daily allowance can
// be tested by moving the clock.

const users = new Map<string, any>(); // id → row
let idCounter = 0;

const mockSendOtpEmail = vi.fn();
const mockQuery = vi.fn().mockResolvedValue({ rows: [] });
const mockCreateUser = vi.fn(async (data: any) => {
  const row = {
    id: `user-${++idCounter}`,
    phone: data.phone ?? null,
    email: data.email ?? null,
    email_verified: data.emailVerified ?? false,
    password_hash: data.passwordHash ?? null,
    auth_provider: data.authProvider,
    display_name: data.displayName ?? null,
    country_code: data.countryCode ?? null,
    city: data.city ?? null,
    country: data.country ?? null,
    latitude: data.latitude ?? null,
    longitude: data.longitude ?? null,
    h3_index: data.h3Index ?? null,
    onboarding_complete: false,
    onboarding_step: 'splash',
    created_at: new Date(),
  };
  users.set(row.id, row);
  return row;
});
const mockFindUserByEmail = vi.fn(async (email: string) => [...users.values()].find((u) => u.email === email) ?? null);

vi.mock('../services/database', () => ({
  query: mockQuery,
  createUser: mockCreateUser,
  findUserByEmail: mockFindUserByEmail,
  findUserByPhone: vi.fn(async (phone: string) => [...users.values()].find((u) => u.phone === phone) ?? null),
  findUserById: vi.fn(async (id: string) => users.get(id) ?? null),
  createSubscription: vi.fn().mockResolvedValue(undefined),
  getSubscription: vi.fn().mockResolvedValue(null),
}));

// ─── In-memory otp-store ──────────────────────────────────────────
const kv = new Map<string, { value: any; expiresAt: number }>();
let storeDown = false;

function live(key: string) {
  const e = kv.get(key);
  if (e && Date.now() >= e.expiresAt) kv.delete(key);
  return kv.get(key);
}
function guard() {
  if (storeDown) throw new Error('connect ECONNREFUSED otp-store:6379');
}

vi.mock('../services/signupStore', () => {
  const TTL = 300;
  const MAX_SENDS = 3;
  const WINDOW = 24 * 3600;
  const pending = (e: string) => `pending:${e}`;
  const sends = (e: string) => `sends:${e}`;
  return {
    SIGNUP_CODE_TTL_SECONDS: TTL,
    SIGNUP_MAX_ATTEMPTS: 3,
    SIGNUP_MAX_SENDS_PER_DAY: MAX_SENDS,
    SIGNUP_RESEND_COOLDOWN_SECONDS: 30,
    claimSend: async (email: string) => {
      guard();
      const e = live(sends(email));
      if (e && e.value >= MAX_SENDS) {
        return { locked: true, retryAfterSeconds: Math.ceil((e.expiresAt - Date.now()) / 1000) };
      }
      if (e) e.value += 1;
      else kv.set(sends(email), { value: 1, expiresAt: Date.now() + WINDOW * 1000 });
      return { locked: false, sendsLeft: MAX_SENDS - live(sends(email))!.value };
    },
    refundSend: async (email: string) => {
      const e = live(sends(email));
      if (e && e.value > 0) e.value -= 1;
    },
    lockSeconds: async (email: string) => {
      guard();
      const e = live(sends(email));
      if (!e || e.value < MAX_SENDS) return 0;
      return Math.ceil((e.expiresAt - Date.now()) / 1000);
    },
    savePending: async (email: string, codeHash: string, data: string) => {
      kv.set(pending(email), {
        value: { codeHash, data, attempts: 0, sentAt: Date.now() },
        expiresAt: Date.now() + TTL * 1000,
      });
    },
    getPending: async (email: string) => {
      guard();
      const e = live(pending(email));
      return e ? { ...e.value } : null;
    },
    recordAttempt: async (email: string) => {
      const e = live(pending(email));
      if (!e) return -1;
      e.value.attempts += 1;
      return e.value.attempts;
    },
    deletePending: async (email: string) => kv.delete(pending(email)),
  };
});

vi.mock('../services/photoStorage', () => ({
  deleteAllUserPhotos: vi.fn(),
  deleteAllUserKycDocuments: vi.fn(),
  deleteChatFile: vi.fn(),
}));
vi.mock('../services/playBilling', () => ({
  isPlayBillingConfigured: () => false,
  cancelSubscription: vi.fn(),
}));
vi.mock('../services/eventBus', () => ({
  eventBus: { sendUserEvent: vi.fn(), publish: vi.fn() },
}));
vi.mock('../services/email', () => ({
  sendOtpEmail: mockSendOtpEmail,
  // "Configured" so the code is random, which is what production users get
  isEmailConfigured: () => true,
  maskEmail: (e: string) => `**${e.slice(e.indexOf('@'))}`,
}));
vi.mock('../services/locations', () => ({
  resolveCity: (countryCode: string, city: string) =>
    countryCode.toUpperCase() === 'IN' && city.toLowerCase() === 'kolkata'
      ? { countryCode: 'IN', countryName: 'India', name: 'Kolkata', stateCode: 'WB', latitude: 22.56, longitude: 88.36 }
      : null,
}));

// ─── App ──────────────────────────────────────────────────────────

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

let clock = Date.UTC(2026, 9, 12, 10, 0, 0);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(clock);
  users.clear();
  kv.clear();
  storeDown = false;
  vi.clearAllMocks();
  mockSendOtpEmail.mockReset().mockResolvedValue(true);
});

afterEach(() => {
  clock += 7 * 24 * 3600 * 1000;
  vi.useRealTimers();
});

const advance = (seconds: number) => vi.setSystemTime(Date.now() + seconds * 1000);

function post(url: string, payload: object) {
  return app.inject({ method: 'POST', url: `/api/v1/auth${url}`, payload });
}

/** The code the (mocked) email service was asked to deliver on its last call. */
function lastEmailedCode(): string {
  const call = mockSendOtpEmail.mock.calls.at(-1);
  if (!call) throw new Error('no OTP email was sent');
  return call[1] as string;
}

const wrongCode = (code: string) => (code === '000000' ? '111111' : '000000');

const EMAIL = 'New.User@Example.com';
const STORED_EMAIL = 'new.user@example.com';
const PASSWORD = 'correct-horse-battery';
const FORM = { email: EMAIL, password: PASSWORD, displayName: 'New', countryCode: 'IN', city: 'Kolkata' };

// ─── Tests ─────────────────────────────────────────────────────────

describe('sign-up: emailed code before the account exists', () => {
  it('emails a code and touches no database until it is verified', async () => {
    const res = await post('/signup', FORM);

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ email: '**@example.com', expiresInSeconds: 300, maxAttempts: 3, sendsLeft: 2 });
    expect(mockSendOtpEmail).toHaveBeenCalledWith(STORED_EMAIL, expect.stringMatching(/^\d{6}$/));

    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockFindUserByEmail).not.toHaveBeenCalled();
    expect(mockCreateUser).not.toHaveBeenCalled();
    // The password is stored only as a bcrypt hash
    expect(JSON.stringify([...kv.values()])).not.toContain(PASSWORD);
  });

  it('the right code creates a verified account and a session', async () => {
    await post('/signup', FORM);
    const res = await post('/signup/verify', { email: EMAIL, otp: lastEmailedCode() });

    expect(res.statusCode).toBe(201);
    const body = res.json().data;
    expect(body.user.email).toBe(STORED_EMAIL);
    expect(body.user.onboardingComplete).toBe(false);
    expect(body.token).toBeTypeOf('string');
    expect(body.refreshToken).toBeTypeOf('string');

    const row = users.get(app.jwt.verify<{ sub: string }>(body.token).sub);
    expect(row.email_verified).toBe(true);
    expect(row.display_name).toBe('New');
    // The signup city seeds the location columns so the feed has an origin
    expect(row).toMatchObject({ country_code: 'IN', city: 'Kolkata', country: 'India', latitude: 22.56, longitude: 88.36 });
    expect(row.h3_index).toMatch(/^87/); // resolution-7 cell
  });

  it('a code works only once', async () => {
    await post('/signup', FORM);
    const code = lastEmailedCode();
    await post('/signup/verify', { email: EMAIL, otp: code });

    const replay = await post('/signup/verify', { email: EMAIL, otp: code });
    expect(replay.statusCode).toBe(410);
    expect(replay.json().error.code).toBe('SIGNUP_EXPIRED');
    expect(users.size).toBe(1);
  });

  it('counts down the attempts and ends the sign-up on the third wrong code', async () => {
    await post('/signup', FORM);
    const code = lastEmailedCode();

    const first = await post('/signup/verify', { email: EMAIL, otp: wrongCode(code) });
    expect(first.statusCode).toBe(400);
    expect(first.json().error).toMatchObject({ code: 'INVALID_OTP', attemptsLeft: 2 });

    const second = await post('/signup/verify', { email: EMAIL, otp: wrongCode(code) });
    expect(second.json().error).toMatchObject({ code: 'INVALID_OTP', attemptsLeft: 1 });

    const third = await post('/signup/verify', { email: EMAIL, otp: wrongCode(code) });
    expect(third.statusCode).toBe(400);
    expect(third.json().error).toMatchObject({ code: 'SIGNUP_FAILED', retryAfterSeconds: 0 });

    // The code is gone, even the right one
    const late = await post('/signup/verify', { email: EMAIL, otp: code });
    expect(late.json().error.code).toBe('SIGNUP_EXPIRED');
    expect(mockCreateUser).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('the code expires after 5 minutes', async () => {
    await post('/signup', FORM);
    const code = lastEmailedCode();
    advance(301);

    const res = await post('/signup/verify', { email: EMAIL, otp: code });
    expect(res.statusCode).toBe(410);
    expect(res.json().error.code).toBe('SIGNUP_EXPIRED');
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('rejects an unknown city without sending anything', async () => {
    const res = await post('/signup', { ...FORM, city: 'Atlantis' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/Unknown city/);
    expect(mockSendOtpEmail).not.toHaveBeenCalled();
  });

  it('rejects a missing password or a short one', async () => {
    expect((await post('/signup', { ...FORM, password: undefined })).statusCode).toBe(400);
    expect((await post('/signup', { ...FORM, password: 'short' })).statusCode).toBe(400);
    expect(mockSendOtpEmail).not.toHaveBeenCalled();
  });

  it('reports an already registered email only after the code is verified', async () => {
    await post('/signup', FORM);
    await post('/signup/verify', { email: EMAIL, otp: lastEmailedCode() });

    const again = await post('/signup', { ...FORM, email: 'NEW.USER@example.com' });
    expect(again.statusCode).toBe(200);
    const res = await post('/signup/verify', { email: EMAIL, otp: lastEmailedCode() });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('EMAIL_EXISTS');
    expect(users.size).toBe(1);
  });

  it('answers 503 and counts nothing when Brevo refuses the send', async () => {
    mockSendOtpEmail.mockResolvedValueOnce(false);
    const failed = await post('/signup', FORM);
    expect(failed.statusCode).toBe(503);

    const retry = await post('/signup', FORM);
    expect(retry.json().data.sendsLeft).toBe(2);
  });

  it('answers 503 when the otp-store is down', async () => {
    storeDown = true;
    const res = await post('/signup', FORM);
    expect(res.statusCode).toBe(503);
    expect(mockSendOtpEmail).not.toHaveBeenCalled();
  });
});

describe('sign-up: resends and the daily allowance', () => {
  it('a resend inside 30 seconds is refused without emailing', async () => {
    await post('/signup', FORM);
    mockSendOtpEmail.mockClear();

    const res = await post('/signup/resend', { email: EMAIL });
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe('RATE_LIMITED');
    expect(mockSendOtpEmail).not.toHaveBeenCalled();
  });

  it('a resend replaces the code and restarts the attempts', async () => {
    await post('/signup', FORM);
    const oldCode = lastEmailedCode();
    await post('/signup/verify', { email: EMAIL, otp: wrongCode(oldCode) });
    await post('/signup/verify', { email: EMAIL, otp: wrongCode(oldCode) });
    advance(31);

    const resend = await post('/signup/resend', { email: EMAIL });
    expect(resend.statusCode).toBe(200);
    expect(resend.json().data.sendsLeft).toBe(1);
    const newCode = lastEmailedCode();

    const wrong = await post('/signup/verify', { email: EMAIL, otp: wrongCode(newCode) });
    expect(wrong.json().error.attemptsLeft).toBe(2);
    const ok = await post('/signup/verify', { email: EMAIL, otp: newCode });
    expect(ok.statusCode).toBe(201);
  });

  it('a resend after the code expired sends the user back to the form', async () => {
    await post('/signup', FORM);
    advance(301);
    const res = await post('/signup/resend', { email: EMAIL });
    expect(res.statusCode).toBe(410);
    expect(res.json().error.code).toBe('SIGNUP_EXPIRED');
  });

  it('allows three codes a day, then locks the email for 24 hours', async () => {
    await post('/signup', FORM);
    advance(31);
    await post('/signup/resend', { email: EMAIL });
    advance(31);
    const third = await post('/signup/resend', { email: EMAIL });
    expect(third.json().data.sendsLeft).toBe(0);
    expect(mockSendOtpEmail).toHaveBeenCalledTimes(3);

    advance(31);
    const fourth = await post('/signup/resend', { email: EMAIL });
    expect(fourth.statusCode).toBe(429);
    expect(fourth.json().error.code).toBe('SIGNUP_LOCKED');

    const again = await post('/signup', FORM);
    expect(again.statusCode).toBe(429);
    const error = again.json().error;
    expect(error.code).toBe('SIGNUP_LOCKED');
    expect(error.retryAfterSeconds).toBeGreaterThan(23 * 3600);
    expect(error.retryAfterSeconds).toBeLessThanOrEqual(24 * 3600);
    expect(mockSendOtpEmail).toHaveBeenCalledTimes(3);

    advance(24 * 3600);
    const nextDay = await post('/signup', FORM);
    expect(nextDay.statusCode).toBe(200);
    expect(nextDay.json().data.sendsLeft).toBe(2);
  });

  it('failing the last code of the day reports the 24-hour lock', async () => {
    await post('/signup', FORM);
    advance(31);
    await post('/signup/resend', { email: EMAIL });
    advance(31);
    await post('/signup/resend', { email: EMAIL });
    const code = lastEmailedCode();

    for (let i = 0; i < 2; i++) await post('/signup/verify', { email: EMAIL, otp: wrongCode(code) });
    const last = await post('/signup/verify', { email: EMAIL, otp: wrongCode(code) });
    expect(last.json().error.code).toBe('SIGNUP_FAILED');
    expect(last.json().error.retryAfterSeconds).toBeGreaterThan(23 * 3600);
  });

  it('the allowance is per email, whatever its casing', async () => {
    for (const email of ['a@example.com', 'A@example.com', 'a@EXAMPLE.com']) {
      await post('/signup', { ...FORM, email });
      advance(31);
    }
    const locked = await post('/signup', { ...FORM, email: 'a@example.com' });
    expect(locked.json().error.code).toBe('SIGNUP_LOCKED');

    const other = await post('/signup', { ...FORM, email: 'b@example.com' });
    expect(other.statusCode).toBe(200);
  });
});

describe('login: email and password, no code', () => {
  beforeEach(async () => {
    await post('/signup', FORM);
    await post('/signup/verify', { email: EMAIL, otp: lastEmailedCode() });
    mockSendOtpEmail.mockClear();
  });

  it('issues a session straight away and sends no email', async () => {
    const res = await post('/login', { email: EMAIL, password: PASSWORD });
    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    expect(body.user.email).toBe(STORED_EMAIL);
    expect(body.user.onboardingComplete).toBe(false);
    expect(body.token).toBeTypeOf('string');
    expect(body.refreshToken).toBeTypeOf('string');
    expect(body).not.toHaveProperty('requiresOtp');
    expect(mockSendOtpEmail).not.toHaveBeenCalled();
  });

  it('refuses a wrong password', async () => {
    const res = await post('/login', { email: EMAIL, password: 'nope-nope-nope' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('INVALID_PASSWORD');
  });

  it('refuses an unknown email', async () => {
    const res = await post('/login', { email: 'nobody@example.com', password: PASSWORD });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('USER_NOT_FOUND');
  });

  it('gives no session for an email plus an unchecked provider id', async () => {
    const res = await post('/login', { email: EMAIL, authProvider: 'google', authProviderId: 'anything' });
    expect(res.statusCode).toBe(400);
    expect(res.json().data).toBeUndefined();
  });
});

describe('removed routes', () => {
  it.each(['/register', '/send-otp', '/verify-otp'])('%s no longer exists', async (url) => {
    const res = await post(url, { ...FORM, authProvider: 'email', otp: '123456' });
    expect(res.statusCode).toBe(404);
    expect(mockCreateUser).not.toHaveBeenCalled();
  });
});
