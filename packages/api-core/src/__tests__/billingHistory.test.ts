import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import jwt from '@fastify/jwt';

// ─── What this covers ─────────────────────────────────────────────
// GET /payments/subscription/history pages by cursor: a page holds the
// `limit` newest payments after the cursor row, `nextCursor` is the last
// row's id while more remain and null on the last page, and the count of
// completed payments comes with the first page only. The database is an
// in-memory list driven by the SQL the route issues, ordered the way the
// query orders Postgres rows: (created_at, id) descending.

interface TxRow {
  id: string;
  user_id: string;
  gateway_payment_id: string;
  gateway_subscription_id: string | null;
  amount: number | null;
  currency: string;
  status: string;
  description: string;
  created_at: Date;
}

const transactions: TxRow[] = [];

function newestFirst(a: TxRow, b: TxRow): number {
  return b.created_at.getTime() - a.created_at.getTime() || (b.id > a.id ? 1 : b.id < a.id ? -1 : 0);
}

const mockQuery = vi.fn(async (sql: string, params: any[] = []) => {
  const text = sql.replace(/\s+/g, ' ');
  if (/FROM transactions WHERE user_id = \$1 AND gateway_subscription_id IS NOT NULL/.test(text)) {
    const [userId, limit, cursor] = params;
    let rows = transactions
      .filter((t) => t.user_id === userId && t.gateway_subscription_id !== null)
      .sort(newestFirst);
    if (/\$3/.test(text)) {
      // (created_at, id) < the cursor row's; a cursor that is not this
      // user's row compares against NULL and matches nothing
      const anchor = rows.find((r) => r.id === cursor);
      rows = anchor ? rows.filter((r) => newestFirst(anchor, r) < 0) : [];
    }
    const completedTotal = rows.filter((r) => r.status === 'completed').length;
    const page = rows.slice(0, limit).map((r) => ({ ...r, completed_total: completedTotal }));
    return { rows: page, rowCount: page.length };
  }
  throw new Error(`unexpected SQL in test: ${text}`);
});

vi.mock('../services/database', () => ({
  query: mockQuery,
  TABLES: {
    TRANSACTIONS: 'transactions',
    SUBSCRIPTION_LEDGER: 'subscription_ledger',
    PLAY_PENDING_PURCHASES: 'play_pending_purchases',
    USERS: 'users',
    MATCHES: 'matches',
    USER_INTERACTIONS: 'user_interactions',
  },
  getSubscription: vi.fn(),
}));

vi.mock('../services/playBilling', async () => {
  const real = await vi.importActual<typeof import('../services/playBilling')>('../services/playBilling');
  return { ...real, isPlayBillingConfigured: () => true };
});

vi.mock('../services/eventBus', () => ({ eventBus: { sendPaymentEvent: vi.fn() } }));
vi.mock('../services/redis', () => ({ getRedis: () => ({ del: vi.fn() }) }));

// ─── Fixtures ─────────────────────────────────────────────────────

const USER = 'user-1';
const OTHER_USER = 'user-2';
const BASE = Date.UTC(2026, 0, 1);

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

/**
 * 25 payments for USER, one per hour, so k=25 is the newest. k=15 and k=16
 * share a timestamp and straddle the default page boundary (10th and 11th
 * newest), which is where a cursor on created_at alone would skip or repeat
 * a row. Two are not completed. One more payment belongs to another user.
 */
function seed() {
  transactions.length = 0;
  for (let k = 1; k <= 25; k++) {
    const hour = k === 16 ? 15 : k;
    transactions.push({
      id: uuid(k),
      user_id: USER,
      gateway_payment_id: `GPA.${k}`,
      gateway_subscription_id: 'token-1',
      amount: k === 1 ? 99 : null,
      currency: 'INR',
      status: k === 3 || k === 7 ? 'pending' : 'completed',
      description: 'Kinetik Premium — weekly',
      created_at: new Date(BASE + hour * 3600_000),
    });
  }
  transactions.push({
    id: uuid(99),
    user_id: OTHER_USER,
    gateway_payment_id: 'GPA.99',
    gateway_subscription_id: 'token-2',
    amount: 99,
    currency: 'INR',
    status: 'completed',
    description: 'Kinetik Premium — weekly',
    created_at: new Date(BASE + 99 * 3600_000),
  });
}

// ─── App ──────────────────────────────────────────────────────────

let app: FastifyInstance;

beforeAll(async () => {
  const { paymentRoutes } = await import('../routes/payments');
  app = Fastify();
  await app.register(jwt, { secret: 'test-secret', sign: { expiresIn: '15m' } });
  await app.register(paymentRoutes, { prefix: '/api/v1/payments' });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  seed();
  mockQuery.mockClear();
});

function history(userId: string, params: Record<string, string> = {}) {
  const token = app.jwt.sign({ sub: userId });
  const qs = new URLSearchParams(params).toString();
  return app.inject({
    method: 'GET',
    url: `/api/v1/payments/subscription/history${qs ? `?${qs}` : ''}`,
    headers: { authorization: `Bearer ${token}` },
  });
}

const ids = (body: any): string[] => body.data.payments.map((p: any) => p.id);
const range = (from: number, to: number): string[] =>
  Array.from({ length: from - to + 1 }, (_, i) => uuid(from - i));

// ─── Tests ────────────────────────────────────────────────────────

describe('GET /payments/subscription/history', () => {
  it('first page: the 10 newest, a cursor for the rest, and the completed total', async () => {
    const res = await history(USER);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(ids(body)).toEqual(range(25, 16));
    expect(body.data.nextCursor).toBe(uuid(16));
    expect(body.data.monthsPaid).toBe(23);
    expect(body.data.payments[0]).toMatchObject({
      id: uuid(25),
      paymentId: 'GPA.25',
      amount: null,
      currency: 'INR',
      status: 'completed',
      description: 'Kinetik Premium — weekly',
    });
    expect(body.data.payments[0].paidAt).toBeDefined();
  });

  it('pages continue exactly after the cursor, across a shared timestamp, to a null cursor', async () => {
    const second = (await history(USER, { cursor: uuid(16) })).json();
    expect(ids(second)).toEqual(range(15, 6));
    expect(second.data.nextCursor).toBe(uuid(6));
    expect(second.data.monthsPaid).toBeUndefined();

    const third = (await history(USER, { cursor: uuid(6) })).json();
    expect(ids(third)).toEqual(range(5, 1));
    expect(third.data.nextCursor).toBeNull();

    // One database round trip per page: the total rides on the first query
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('a larger limit shortens the walk; a null cursor when the page is not full', async () => {
    const body = (await history(USER, { limit: '50' })).json();
    expect(ids(body)).toHaveLength(25);
    expect(body.data.nextCursor).toBeNull();
    expect(body.data.monthsPaid).toBe(23);
  });

  it('rejects a bad page request', async () => {
    expect((await history(USER, { limit: '0' })).statusCode).toBe(400);
    expect((await history(USER, { limit: '51' })).statusCode).toBe(400);
    expect((await history(USER, { cursor: 'not-a-uuid' })).statusCode).toBe(400);
  });

  it("another account's payment is not a usable cursor", async () => {
    const body = (await history(USER, { cursor: uuid(99) })).json();
    expect(body.data.payments).toEqual([]);
    expect(body.data.nextCursor).toBeNull();
  });

  it('an account with no payments gets an empty first page and a zero total', async () => {
    const body = (await history('user-3')).json();
    expect(body.data.payments).toEqual([]);
    expect(body.data.nextCursor).toBeNull();
    expect(body.data.monthsPaid).toBe(0);
  });
});
