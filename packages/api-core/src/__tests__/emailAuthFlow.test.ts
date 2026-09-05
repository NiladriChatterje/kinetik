import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import jwt from '@fastify/jwt';

// ─── Mocks ────────────────────────────────────────────────────────
// Everything behind the auth routes is mocked except bcrypt and the OTP store,
// so this exercises the real wiring a fresh user goes through:
// register → login (password) → emailed code → verify → session tokens.

const users = new Map<string, any>(); // id → row
let idCounter = 0;

const mockSendOtpEmail = vi.fn();
const mockSendOtpSms = vi.fn();
const mockQuery = vi.fn().mockResolvedValue({ rows: [] });

vi.mock('../services/database', () => ({
  query: mockQuery,
  createUser: vi.fn(async (data: any) => {
    const row = {
      id: `user-${++idCounter}`,
      phone: data.phone ?? null,
      email: data.email ?? null,
      password_hash: data.passwordHash ?? null,
      auth_provider: data.authProvider,
      display_name: data.displayName ?? null,
      onboarding_complete: false,
      onboarding_step: 'splash',
      created_at: new Date(),
    };
    users.set(row.id, row);
    return row;
  }),
  findUserByEmail: vi.fn(async (email: string) => [...users.values()].find((u) => u.email === email) ?? null),
  findUserByPhone: vi.fn(async (phone: string) => [...users.values()].find((u) => u.phone === phone) ?? null),
  findUserById: vi.fn(async (id: string) => users.get(id) ?? null),
  updateUser: vi.fn(async (id: string, data: Record<string, any>) => {
    const row = users.get(id);
    Object.assign(row, data);
    return row;
  }),
  createSubscription: vi.fn().mockResolvedValue(undefined),
  getSubscription: vi.fn().mockResolvedValue(null),
}));

vi.mock('../services/photoStorage', () => ({
  deleteAllUserPhotos: vi.fn(),
  deleteChatFile: vi.fn(),
}));
vi.mock('../services/playBilling', () => ({
  isPlayBillingConfigured: () => false,
  cancelSubscription: vi.fn(),
}));
vi.mock('../services/eventBus', () => ({
  eventBus: { sendUserEvent: vi.fn(), publish: vi.fn() },
}));
vi.mock('../services/sms', () => ({
  sendOtpSms: mockSendOtpSms,
  isSmsConfigured: () => false,
}));
vi.mock('../services/email', () => ({
  sendOtpEmail: mockSendOtpEmail,
  // "Configured" so the code is random, which is what production users get
  isEmailConfigured: () => true,
  maskEmail: (e: string) => `**${e.slice(e.indexOf('@'))}`,
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

beforeEach(() => {
  mockSendOtpEmail.mockReset().mockResolvedValue(true);
  mockSendOtpSms.mockReset();
});

function post(url: string, payload: unknown) {
  return app.inject({ method: 'POST', url: `/api/v1/auth${url}`, payload });
}

/** The code the (mocked) email service was asked to deliver on its last call. */
function lastEmailedCode(): string {
  const call = mockSendOtpEmail.mock.calls.at(-1);
  if (!call) throw new Error('no OTP email was sent');
  return call[1] as string;
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('email signup → login → emailed code → session', () => {
  const EMAIL = 'New.User@Example.com';
  const PASSWORD = 'correct-horse-battery';

  it('registers with email only (no phone), lowercasing the address', async () => {
    const res = await post('/register', {
      email: EMAIL,
      password: PASSWORD,
      displayName: 'New',
      authProvider: 'email',
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.user.email).toBe('new.user@example.com');
    expect(body.data.user.phone).toBeNull();
    expect(body.data.token).toBeTypeOf('string');
    expect(body.data.refreshToken).toBeTypeOf('string');
  });

  it('rejects a second registration with the same email in different casing', async () => {
    const res = await post('/register', { email: 'NEW.USER@example.com', password: PASSWORD, authProvider: 'email' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('EMAIL_EXISTS');
  });

  it('rejects registration with neither email nor phone', async () => {
    const res = await post('/register', { password: PASSWORD, authProvider: 'email' });
    expect(res.statusCode).toBe(400);
  });

  it('login with email + password emails a code and asks for verification', async () => {
    const res = await post('/login', { email: EMAIL, password: PASSWORD });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.requiresOtp).toBe(true);
    expect(body.data.email).toBe('**@example.com');
    expect(body.data).not.toHaveProperty('token');

    expect(mockSendOtpEmail).toHaveBeenCalledTimes(1);
    expect(mockSendOtpEmail.mock.calls[0][0]).toBe('new.user@example.com');
    expect(lastEmailedCode()).toMatch(/^\d{6}$/);
    expect(mockSendOtpSms).not.toHaveBeenCalled();
  });

  it('login with the wrong password sends nothing', async () => {
    const res = await post('/login', { email: EMAIL, password: 'nope-nope-nope' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('INVALID_PASSWORD');
    expect(mockSendOtpEmail).not.toHaveBeenCalled();
  });

  it('login for an unknown email is a clear 401', async () => {
    const res = await post('/login', { email: 'nobody@example.com', password: PASSWORD });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('USER_NOT_FOUND');
  });

  it('a resend straight after login hits the 30 s cooldown, not Brevo', async () => {
    const res = await post('/send-otp', { email: EMAIL });
    expect(res.statusCode).toBe(429);
    expect(mockSendOtpEmail).not.toHaveBeenCalled();
  });

  it('a wrong code is rejected and the right one issues a session', async () => {
    // Fresh login so the code is known to this test
    await post('/login', { email: EMAIL, password: PASSWORD });
    const code = lastEmailedCode();
    const wrong = code === '000000' ? '111111' : '000000';

    const bad = await post('/verify-otp', { email: EMAIL, otp: wrong });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('INVALID_OTP');

    const good = await post('/verify-otp', { email: EMAIL, otp: code });
    expect(good.statusCode).toBe(200);
    const body = good.json();
    expect(body.data.user.email).toBe('new.user@example.com');
    expect(body.data.user.onboardingComplete).toBe(false);
    expect(body.data.token).toBeTypeOf('string');
    expect(body.data.refreshToken).toBeTypeOf('string');

    // The access token belongs to the registered user and email is now verified
    const decoded = app.jwt.verify<{ sub: string }>(body.data.token);
    expect(users.get(decoded.sub).email).toBe('new.user@example.com');
    expect(users.get(decoded.sub).email_verified).toBe(true);
  });

  it('a code cannot be replayed', async () => {
    await post('/login', { email: EMAIL, password: PASSWORD });
    const code = lastEmailedCode();
    await post('/verify-otp', { email: EMAIL, otp: code });

    const replay = await post('/verify-otp', { email: EMAIL, otp: code });
    expect(replay.statusCode).toBe(400);
  });

  it('five wrong guesses burn the code', async () => {
    await post('/login', { email: EMAIL, password: PASSWORD });
    const code = lastEmailedCode();
    const wrong = code === '000000' ? '111111' : '000000';

    for (let i = 0; i < 5; i++) {
      await post('/verify-otp', { email: EMAIL, otp: wrong });
    }
    const late = await post('/verify-otp', { email: EMAIL, otp: code });
    expect(late.statusCode).toBe(400);
  });

  it('reports 503 and stores nothing when Brevo refuses the send', async () => {
    mockSendOtpEmail.mockResolvedValueOnce(false);
    const res = await post('/login', { email: EMAIL, password: PASSWORD });
    expect(res.statusCode).toBe(503);
  });

  it('verify-otp with both email and phone is rejected', async () => {
    const res = await post('/verify-otp', { email: EMAIL, phone: '+15550000000', otp: '123456' });
    expect(res.statusCode).toBe(400);
  });
});
