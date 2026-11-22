import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import jwt from '@fastify/jwt';

// ─── Name, date of birth and gender are locked after onboarding ─────
// Set during onboarding; once it is finished PUT /users/profile refuses a
// different value, drops an unchanged one, and still lets a never-set value
// be set once. Everything else on the profile stays editable.

const USER = '22222222-2222-4222-8222-222222222222';

let lockRow: Record<string, unknown> | undefined;

const { mockQuery, mockUpdateUser, mockFindUserById } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockUpdateUser: vi.fn(async (_id: string, data: Record<string, unknown>) => ({ id: '22222222-2222-4222-8222-222222222222', ...data })),
  mockFindUserById: vi.fn(async () => ({ id: '22222222-2222-4222-8222-222222222222', display_name: 'Asha' })),
}));

vi.mock('../services/database', () => ({
  query: mockQuery,
  TABLES: { USERS: 'users', PROFILE_PHOTOS: 'profile_photos' },
  findUserById: mockFindUserById,
  updateUser: mockUpdateUser,
  getPreferences: vi.fn(),
  upsertPreferences: vi.fn(),
}));
vi.mock('../services/eventBus', () => ({ eventBus: { sendUserEvent: vi.fn() } }));
vi.mock('../services/redis', () => ({ getRedis: () => ({ set: vi.fn(), get: vi.fn(), del: vi.fn() }) }));
vi.mock('../services/geocoding', () => ({ reverseGeocode: vi.fn() }));
vi.mock('../services/locations', () => ({ resolveCity: vi.fn() }));

let app: FastifyInstance;

beforeAll(async () => {
  const { userRoutes } = await import('../routes/users');
  app = Fastify();
  await app.register(jwt, { secret: 'test-secret' });
  await app.register(userRoutes, { prefix: '/api/v1/users' });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  lockRow = { onboarding_complete: true, display_name: 'Asha', gender: 'female', dob: '1996-04-12' };
  mockQuery.mockImplementation(async (sql: string) =>
    sql.includes('onboarding_complete, display_name, gender')
      ? { rows: lockRow ? [lockRow] : [], rowCount: lockRow ? 1 : 0 }
      : { rows: [], rowCount: 0 },
  );
});

const put = (payload: unknown) =>
  app.inject({
    method: 'PUT',
    url: '/api/v1/users/profile',
    payload: payload as any,
    headers: { authorization: `Bearer ${app.jwt.sign({ sub: USER })}` },
  });

describe('PUT /users/profile after onboarding', () => {
  it.each([
    ['name', { displayName: 'Someone Else' }],
    ['date of birth', { dateOfBirth: '1990-01-01' }],
    ['gender', { gender: 'male' }],
    ['gender to a retired value', { gender: 'other' }],
  ])('refuses a changed %s and stores nothing', async (_label, payload) => {
    const res = await put({ ...payload, bio: 'Hello' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('PROFILE_FIELD_LOCKED');
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('drops unchanged locked values and saves the rest', async () => {
    const res = await put({ displayName: ' Asha ', dateOfBirth: '1996-04-12', gender: 'female', bio: 'Hello' });
    expect(res.statusCode).toBe(200);
    expect(mockUpdateUser).toHaveBeenCalledWith(USER, { bio: 'Hello' });
  });

  it('answers with the profile when only unchanged locked values were sent', async () => {
    const res = await put({ gender: 'female' });
    expect(res.statusCode).toBe(200);
    expect(mockUpdateUser).not.toHaveBeenCalled();
    expect(mockFindUserById).toHaveBeenCalledWith(USER);
  });

  it('keeps a retired gender a profile already holds', async () => {
    lockRow = { ...lockRow, gender: 'non_binary' };
    const res = await put({ gender: 'non_binary', pronouns: 'they/them' });
    expect(res.statusCode).toBe(200);
    expect(mockUpdateUser).toHaveBeenCalledWith(USER, { pronouns: 'they/them' });
  });

  it('lets a value never set before be set once', async () => {
    lockRow = { ...lockRow, gender: null };
    const res = await put({ gender: 'prefer_not_to_say' });
    expect(res.statusCode).toBe(200);
    expect(mockUpdateUser).toHaveBeenCalledWith(USER, { gender: 'prefer_not_to_say' });
  });

  it('leaves choices and preferences editable without reading the lock', async () => {
    const res = await put({ pronouns: 'she/her', datingCategory: 'serious', occupation: 'Designer' });
    expect(res.statusCode).toBe(200);
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockUpdateUser).toHaveBeenCalled();
  });
});

describe('PUT /users/profile during onboarding', () => {
  it('lets the identity step set and change name, date of birth and gender', async () => {
    lockRow = { ...lockRow, onboarding_complete: false };
    const res = await put({ displayName: 'Asha R', dateOfBirth: '1996-04-13', gender: 'prefer_not_to_say' });
    expect(res.statusCode).toBe(200);
    expect(mockUpdateUser).toHaveBeenCalledWith(USER, expect.objectContaining({
      display_name: 'Asha R', date_of_birth: '1996-04-13', gender: 'prefer_not_to_say',
    }));
  });
});
