import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import jwt from '@fastify/jwt';
import { isAdultBirthDate, birthDateToIso } from '../services/age';

// ─── 18+ on the server ──────────────────────────────────────────────
// The app refuses minors on its identity screen; these checks make sure a
// hand-made API call cannot either set a minor's date of birth or finish
// onboarding without an adult one.

describe('isAdultBirthDate', () => {
  // 12:00 UTC on 18 Oct 2026 = 17:30 in India
  const now = new Date('2026-10-18T12:00:00Z');

  it('accepts someone who turned 18 today or earlier', () => {
    expect(isAdultBirthDate('2008-10-18', now)).toBe(true);
    expect(isAdultBirthDate('1990-01-01', now)).toBe(true);
  });

  it('refuses someone who turns 18 after the latest timezone\'s today', () => {
    // 18 Oct 12:00 UTC is already 19 Oct 02:00 in UTC+14, so a 19 Oct
    // birthday has begun somewhere; 20 Oct has not
    expect(isAdultBirthDate('2008-10-19', now)).toBe(true);
    expect(isAdultBirthDate('2008-10-20', now)).toBe(false);
    expect(isAdultBirthDate('2015-06-01', now)).toBe(false);
  });

  it('never refuses an 18th birthday early in the morning in India', () => {
    // 00:30 IST on 18 Oct is still 17 Oct in UTC
    const earlyIndia = new Date('2026-10-17T19:00:00Z');
    expect(isAdultBirthDate('2008-10-18', earlyIndia)).toBe(true);
  });

  it('handles a 29 February birthday in a non-leap year', () => {
    // Born 29 Feb 2008: turns 18 on 1 Mar 2026
    expect(isAdultBirthDate('2008-02-29', new Date('2026-02-27T00:00:00Z'))).toBe(false);
    expect(isAdultBirthDate('2008-02-29', new Date('2026-03-01T00:00:00Z'))).toBe(true);
  });

  it('refuses dates that are not real or are absurd', () => {
    expect(isAdultBirthDate('2001-02-30', now)).toBe(false);
    expect(isAdultBirthDate('2001-13-01', now)).toBe(false);
    expect(isAdultBirthDate('1899-12-31', now)).toBe(false);
    expect(isAdultBirthDate('2030-01-01', now)).toBe(false);
    expect(isAdultBirthDate('18/10/2000', now)).toBe(false);
    expect(isAdultBirthDate('', now)).toBe(false);
    expect(isAdultBirthDate(null, now)).toBe(false);
  });
});

describe('birthDateToIso', () => {
  it('reads node-pg dates (local midnight) and strings', () => {
    expect(birthDateToIso(new Date(2000, 4, 9))).toBe('2000-05-09');
    expect(birthDateToIso('2000-05-09')).toBe('2000-05-09');
    expect(birthDateToIso('2000-05-09T00:00:00.000Z')).toBe('2000-05-09');
    expect(birthDateToIso(null)).toBeNull();
    expect(birthDateToIso(new Date('nope'))).toBeNull();
  });
});

// ─── The routes ─────────────────────────────────────────────────────

const USER = '11111111-1111-4111-8111-111111111111';
let storedDob: Date | null;

const mockUpdateUser = vi.fn(async (_id: string, data: Record<string, unknown>) => ({ id: USER, ...data }));
const mockFindUserById = vi.fn(async () => ({ id: USER, date_of_birth: storedDob }));
const mockRedisSet = vi.fn();

vi.mock('../services/database', () => ({
  query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
  TABLES: { USERS: 'users', PROFILE_PHOTOS: 'profile_photos' },
  findUserById: mockFindUserById,
  updateUser: mockUpdateUser,
  getPreferences: vi.fn(),
  upsertPreferences: vi.fn(),
}));
vi.mock('../services/eventBus', () => ({ eventBus: { sendUserEvent: vi.fn() } }));
vi.mock('../services/redis', () => ({ getRedis: () => ({ set: mockRedisSet, get: vi.fn(), del: vi.fn() }) }));
vi.mock('../services/geocoding', () => ({ reverseGeocode: vi.fn() }));
vi.mock('../services/locations', () => ({ resolveCity: vi.fn() }));

let app: FastifyInstance;

beforeAll(async () => {
  const { userRoutes } = await import('../routes/users');
  const { onboardingRoutes } = await import('../routes/onboarding');
  app = Fastify();
  await app.register(jwt, { secret: 'test-secret' });
  await app.register(userRoutes, { prefix: '/api/v1/users' });
  await app.register(onboardingRoutes, { prefix: '/api/v1/onboarding' });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  storedDob = new Date(1995, 6, 14);
});

const send = (method: 'PUT' | 'POST', url: string, payload: unknown) =>
  app.inject({ method, url, payload: payload as any, headers: { authorization: `Bearer ${app.jwt.sign({ sub: USER })}` } });

describe('PUT /users/profile', () => {
  it('refuses a minor\'s date of birth and stores nothing', async () => {
    const res = await send('PUT', '/api/v1/users/profile', { displayName: 'Kid', dateOfBirth: '2012-03-04' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/18/);
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('refuses a date that does not exist', async () => {
    const res = await send('PUT', '/api/v1/users/profile', { dateOfBirth: '1999-02-30' });
    expect(res.statusCode).toBe(400);
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('stores an adult\'s date of birth', async () => {
    const res = await send('PUT', '/api/v1/users/profile', { dateOfBirth: '1999-02-28' });
    expect(res.statusCode).toBe(200);
    expect(mockUpdateUser).toHaveBeenCalledWith(USER, expect.objectContaining({ date_of_birth: '1999-02-28' }));
  });

  it('leaves profile edits without a date of birth alone', async () => {
    const res = await send('PUT', '/api/v1/users/profile', { bio: 'Hello' });
    expect(res.statusCode).toBe(200);
    expect(mockUpdateUser).toHaveBeenCalled();
  });
});

describe('POST /onboarding/step', () => {
  it('lets an adult finish onboarding', async () => {
    const res = await send('POST', '/api/v1/onboarding/step', { step: 'complete' });
    expect(res.statusCode).toBe(200);
    expect(mockUpdateUser).toHaveBeenCalledWith(USER, expect.objectContaining({ onboarding_complete: true }));
  });

  it('refuses to finish onboarding with no date of birth', async () => {
    storedDob = null;
    const res = await send('POST', '/api/v1/onboarding/step', { step: 'complete' });
    expect(res.statusCode).toBe(400);
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('refuses to finish onboarding with a minor\'s date of birth', async () => {
    storedDob = new Date(2013, 0, 1);
    const res = await send('POST', '/api/v1/onboarding/step', { step: 'complete' });
    expect(res.statusCode).toBe(400);
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('does not check age on earlier steps', async () => {
    storedDob = null;
    const res = await send('POST', '/api/v1/onboarding/step', { step: 'identity' });
    expect(res.statusCode).toBe(200);
    expect(mockFindUserById).not.toHaveBeenCalled();
  });
});
