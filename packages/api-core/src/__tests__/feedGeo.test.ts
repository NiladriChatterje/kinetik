import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import jwt from '@fastify/jwt';

// ─── Mocks ────────────────────────────────────────────────────────
// The database is a recorder: every SQL statement and its parameter list is
// captured so the tests can check the generated feed query is well-formed
// (every $N referenced, every parameter used) and geo-aware when it should be.

let viewerRow: Record<string, any> = {};
let profileRows: Record<string, any>[] = [];

const mockQuery = vi.fn(async (sql: string, _params?: any[]) => {
  if (sql.includes('age_min, age_max, max_distance_km')) {
    return { rows: [{ age_min: 18, age_max: 60, max_distance_km: 25 }], rowCount: 1 };
  }
  if (sql.includes('SELECT h3_index')) {
    return { rows: [viewerRow], rowCount: 1 };
  }
  if (sql.includes('onboarding_complete = TRUE')) {
    return { rows: profileRows, rowCount: profileRows.length };
  }
  return { rows: [], rowCount: 0 };
});

vi.mock('../services/database', async () => {
  const shared = await vi.importActual<any>('@kinetik/shared');
  return { query: mockQuery, TABLES: shared.TABLES };
});
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
  token = app.jwt.sign({ sub: 'viewer-1' });
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  mockQuery.mockClear();
  profileRows = [];
});

async function getProfiles(qs = '') {
  const res = await app.inject({
    method: 'GET',
    url: `/api/v1/matches/profiles${qs}`,
    headers: { authorization: `Bearer ${token}` },
  });
  expect(res.statusCode).toBe(200);
  return res.json();
}

/** The feed SELECT(s) issued during the last request, with their params. */
function feedQueries(): { sql: string; params: any[] }[] {
  return mockQuery.mock.calls
    .filter(([sql]) => String(sql).includes('onboarding_complete = TRUE'))
    .map(([sql, params]) => ({ sql: String(sql), params: params ?? [] }));
}

/** pg rejects a statement whose $N placeholders do not exactly cover 1..params.length. */
function expectPlaceholdersMatchParams({ sql, params }: { sql: string; params: any[] }) {
  const used = new Set([...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
  const expected = new Set(params.map((_, i) => i + 1));
  expect([...used].sort((a, b) => a - b)).toEqual([...expected].sort((a, b) => a - b));
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('GET /matches/profiles — distance-aware feed', () => {
  describe('viewer without any location', () => {
    beforeEach(() => {
      viewerRow = { h3_index: null, date_of_birth: '1995-01-01', gender: 'female', latitude: null, longitude: null, preferred_latitude: null, preferred_longitude: null };
    });

    it('swipe deck stays a random draw and every placeholder is bound', async () => {
      await getProfiles();
      const queries = feedQueries();
      expect(queries.length).toBeGreaterThan(0);
      for (const q of queries) {
        expectPlaceholdersMatchParams(q);
        expect(q.sql).toContain('ORDER BY RANDOM()');
        expect(q.sql).not.toContain('acos(');
      }
    });

    it('explore keeps newest-first ordering', async () => {
      await getProfiles('?scope=explore&offset=0&limit=10');
      const [q] = feedQueries();
      expectPlaceholdersMatchParams(q);
      expect(q.sql).not.toContain('NULLS LAST');
      expect(q.sql).toContain('ORDER BY u.created_at DESC');
    });
  });

  describe('viewer with own GPS location only', () => {
    beforeEach(() => {
      viewerRow = { h3_index: '87...', date_of_birth: '1995-01-01', gender: 'male', latitude: 22.57, longitude: 88.36, preferred_latitude: null, preferred_longitude: null };
    });

    it('swipe deck filters to max distance and orders nearest first', async () => {
      profileRows = [{ id: 'p1', display_name: 'A', date_of_birth: '1996-05-05', h3_index: null, distance_km: '3.4' }];
      const body = await getProfiles();

      const queries = feedQueries();
      expect(queries).toHaveLength(1); // no TABLESAMPLE pass when geo-ordering
      const [q] = queries;
      expectPlaceholdersMatchParams(q);
      expect(q.sql).not.toContain('TABLESAMPLE');
      expect(q.sql).toContain('AS distance_km');
      expect(q.sql).toContain('ORDER BY distance_km ASC');
      expect(q.sql).toContain('u.latitude IS NOT NULL'); // the distance cut-off clause
      // origin lat, lng, then the max-distance preference, after the gender filter
      expect(q.params.slice(-3)).toEqual([22.57, 88.36, 25]);

      expect(body.data.profiles[0].distanceKm).toBe(3);
    });

    it('explore has no distance cut-off but sorts nearest first, unknown last', async () => {
      await getProfiles('?scope=explore&offset=5&limit=10');
      const [q] = feedQueries();
      expectPlaceholdersMatchParams(q);
      expect(q.sql).toContain('ORDER BY distance_km ASC NULLS LAST');
      expect(q.sql).not.toContain('u.latitude IS NOT NULL'); // no distance cut-off in explore
      expect(q.params.slice(-4)).toEqual([22.57, 88.36, 5, 11]); // offset, limit + 1
    });
  });

  describe('viewer with a preferred location', () => {
    beforeEach(() => {
      viewerRow = { h3_index: '87...', date_of_birth: '1995-01-01', gender: 'other', latitude: 10, longitude: 10, preferred_latitude: 19.07, preferred_longitude: 72.88 };
    });

    it('the preferred city wins over the own location as the origin', async () => {
      await getProfiles();
      const [q] = feedQueries();
      expectPlaceholdersMatchParams(q);
      expect(q.params).toContain(19.07);
      expect(q.params).toContain(72.88);
      expect(q.params).not.toContain(10);
    });
  });
});
