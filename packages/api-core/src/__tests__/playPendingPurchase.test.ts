import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import jwt from '@fastify/jwt';

// ─── What this covers ─────────────────────────────────────────────
// A UPI Autopay purchase can come back from Play as SUBSCRIPTION_STATE_PENDING.
// The server must grant nothing, but it must remember whose purchase it is so
// the RTDN that arrives when the bank confirms — carrying only the purchase
// token — can be resolved to a user, grant Premium and acknowledge the purchase
// before Google's three-day auto-refund.
//
// The database is a tiny in-memory model of the two tables involved, driven
// by the SQL the entitlement service actually issues.

interface LedgerRow {
  user_id: string;
  tier: string;
  gateway_subscription_id: string | null;
  expires_at: Date | null;
  auto_renew: boolean;
}

const ledger = new Map<string, LedgerRow>(); // user_id → row
const pending = new Map<string, { user_id: string; product_id: string | null }>(); // token → row
const transactions: any[] = [];

const mockQuery = vi.fn(async (sql: string, params: any[] = []) => {
  const text = sql.replace(/\s+/g, ' ');

  if (/SELECT user_id FROM subscription_ledger WHERE gateway_subscription_id = \$1/.test(text)) {
    const row = [...ledger.values()].find((r) => r.gateway_subscription_id === params[0]);
    return { rows: row ? [{ user_id: row.user_id }] : [], rowCount: row ? 1 : 0 };
  }
  if (/SELECT user_id FROM play_pending_purchases WHERE purchase_token = \$1/.test(text)) {
    const row = pending.get(params[0]);
    return { rows: row ? [{ user_id: row.user_id }] : [], rowCount: row ? 1 : 0 };
  }
  if (/INSERT INTO play_pending_purchases/.test(text)) {
    const [token, userId, productId] = params;
    const existing = pending.get(token);
    if (!existing) pending.set(token, { user_id: userId, product_id: productId });
    else if (existing.user_id === userId) existing.product_id = productId ?? existing.product_id;
    return { rows: [], rowCount: 1 };
  }
  if (/DELETE FROM play_pending_purchases WHERE purchase_token = \$1/.test(text)) {
    const had = pending.delete(params[0]);
    return { rows: [], rowCount: had ? 1 : 0 };
  }
  if (/INSERT INTO subscription_ledger/.test(text)) {
    const [userId, , token, expiresAt, autoRenew] = params;
    ledger.set(userId, {
      user_id: userId,
      tier: 'premium',
      gateway_subscription_id: token,
      expires_at: expiresAt,
      auto_renew: autoRenew,
    });
    return { rows: [], rowCount: 1 };
  }
  if (/UPDATE subscription_ledger SET tier = 'free'/.test(text)) {
    const [userId, , expiresAt, token] = params;
    const row = ledger.get(userId);
    if (!row || row.gateway_subscription_id !== token) return { rows: [], rowCount: 0 };
    Object.assign(row, { tier: 'free', auto_renew: false, expires_at: expiresAt });
    return { rows: [], rowCount: 1 };
  }
  if (/INSERT INTO transactions/.test(text)) {
    const [userId, orderId, token, amount, currency] = params;
    if (!transactions.some((t) => t.orderId === orderId)) {
      transactions.push({ userId, orderId, token, amount, currency });
    }
    return { rows: [], rowCount: 1 };
  }
  throw new Error(`unexpected SQL in test: ${text}`);
});

vi.mock('../services/database', () => ({
  query: mockQuery,
  TABLES: {
    SUBSCRIPTION_LEDGER: 'subscription_ledger',
    PLAY_PENDING_PURCHASES: 'play_pending_purchases',
    TRANSACTIONS: 'transactions',
    USERS: 'users',
    MATCHES: 'matches',
    USER_INTERACTIONS: 'user_interactions',
  },
  getSubscription: vi.fn(async (userId: string) => ledger.get(userId) ?? null),
}));

const mockGetSubscriptionPurchase = vi.fn();
const mockAcknowledge = vi.fn().mockResolvedValue(undefined);
const RTDN_SECRET = 'rtdn-test-secret';

vi.mock('../services/playBilling', async () => {
  const real = await vi.importActual<typeof import('../services/playBilling')>('../services/playBilling');
  return {
    ...real,
    isPlayBillingConfigured: () => true,
    getSubscriptionPurchase: mockGetSubscriptionPurchase,
    acknowledgeSubscription: mockAcknowledge,
    cancelSubscription: vi.fn(),
  };
});

const mockSendPaymentEvent = vi.fn().mockResolvedValue(undefined);
vi.mock('../services/eventBus', () => ({
  eventBus: { sendPaymentEvent: mockSendPaymentEvent },
}));

const mockRedisDel = vi.fn().mockResolvedValue(1);
vi.mock('../services/redis', () => ({
  getRedis: () => ({ del: mockRedisDel }),
}));

// ─── Fixtures ─────────────────────────────────────────────────────

const PRODUCT = 'kinetik_premium_weekly';
const IN_A_MONTH = new Date(Date.now() + 30 * 24 * 3600 * 1000);

function playState(state: string, overrides: Partial<Record<string, any>> = {}) {
  const entitled = [
    'SUBSCRIPTION_STATE_ACTIVE',
    'SUBSCRIPTION_STATE_CANCELED',
    'SUBSCRIPTION_STATE_IN_GRACE_PERIOD',
  ].includes(state);
  return {
    entitled,
    expiresAt: entitled ? IN_A_MONTH : null,
    autoRenewing: state === 'SUBSCRIPTION_STATE_ACTIVE',
    productId: PRODUCT,
    orderId: entitled ? 'GPA.0000-0000-0000-00001' : null,
    state,
    needsAcknowledgement: entitled,
    isTestPurchase: false,
    ...overrides,
  };
}

function rtdnBody(purchaseToken: string, notificationType: number) {
  const notification = {
    version: '1.0',
    packageName: 'com.kinetik.app',
    eventTimeMillis: String(Date.now()),
    subscriptionNotification: { version: '1.0', notificationType, purchaseToken },
  };
  return {
    message: {
      data: Buffer.from(JSON.stringify(notification)).toString('base64'),
      messageId: `msg-${notificationType}-${purchaseToken}`,
    },
    subscription: 'projects/x/subscriptions/y',
  };
}

// ─── App ──────────────────────────────────────────────────────────

let app: FastifyInstance;

beforeAll(async () => {
  process.env.GOOGLE_PLAY_RTDN_SECRET = RTDN_SECRET;
  const { paymentRoutes } = await import('../routes/payments');
  const { webhookRoutes } = await import('../routes/webhooks');
  app = Fastify();
  await app.register(jwt, { secret: 'test-secret', sign: { expiresIn: '15m' } });
  await app.register(paymentRoutes, { prefix: '/api/v1/payments' });
  await app.register(webhookRoutes, { prefix: '/api/v1/webhooks' });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  delete process.env.GOOGLE_PLAY_RTDN_SECRET;
});

beforeEach(() => {
  ledger.clear();
  pending.clear();
  transactions.length = 0;
  mockGetSubscriptionPurchase.mockReset();
  mockAcknowledge.mockClear();
  mockSendPaymentEvent.mockClear();
  mockRedisDel.mockClear();
});

function verify(userId: string, purchaseToken: string) {
  const token = app.jwt.sign({ sub: userId });
  return app.inject({
    method: 'POST',
    url: '/api/v1/payments/subscription/verify',
    headers: { authorization: `Bearer ${token}` },
    payload: { purchaseToken, productId: PRODUCT, priceAmount: 99, priceCurrency: 'INR' },
  });
}

function rtdn(purchaseToken: string, notificationType: number) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/webhooks/play?secret=${RTDN_SECRET}`,
    payload: rtdnBody(purchaseToken, notificationType),
  });
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('pending UPI mandate → RTDN completes it', () => {
  const USER = 'user-a';
  const TOKEN = 'play-token-pending-1';

  it('grants nothing while pending but binds the token to the account', async () => {
    mockGetSubscriptionPurchase.mockResolvedValue(playState('SUBSCRIPTION_STATE_PENDING'));

    const res = await verify(USER, TOKEN);

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ verified: true, activated: false, pending: true });
    expect(ledger.has(USER)).toBe(false);
    expect(pending.get(TOKEN)).toEqual({ user_id: USER, product_id: PRODUCT });
    expect(mockAcknowledge).not.toHaveBeenCalled();
    expect(mockSendPaymentEvent).not.toHaveBeenCalled();
  });

  it('the completion RTDN resolves the user, grants Premium, acknowledges, and clears the pending row', async () => {
    mockGetSubscriptionPurchase.mockResolvedValueOnce(playState('SUBSCRIPTION_STATE_PENDING'));
    await verify(USER, TOKEN);

    mockGetSubscriptionPurchase.mockResolvedValueOnce(playState('SUBSCRIPTION_STATE_ACTIVE'));
    const res = await rtdn(TOKEN, 4 /* SUBSCRIPTION_PURCHASED */);

    expect(res.statusCode).toBe(200);
    expect(ledger.get(USER)).toMatchObject({
      tier: 'premium',
      gateway_subscription_id: TOKEN,
      auto_renew: true,
    });
    expect(pending.has(TOKEN)).toBe(false);
    expect(mockAcknowledge).toHaveBeenCalledWith(TOKEN);
    expect(transactions).toHaveLength(1);
    expect(mockSendPaymentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'subscription.activated' }),
    );
  });

  it('a rejected mandate is forgotten without touching the ledger', async () => {
    mockGetSubscriptionPurchase.mockResolvedValueOnce(playState('SUBSCRIPTION_STATE_PENDING'));
    await verify(USER, TOKEN);

    mockGetSubscriptionPurchase.mockResolvedValueOnce(
      playState('SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED'),
    );
    const res = await rtdn(TOKEN, 20 /* SUBSCRIPTION_PENDING_PURCHASE_CANCELED */);

    expect(res.statusCode).toBe(200);
    expect(ledger.has(USER)).toBe(false);
    expect(pending.has(TOKEN)).toBe(false);
    expect(mockAcknowledge).not.toHaveBeenCalled();
    expect(mockSendPaymentEvent).not.toHaveBeenCalled();
  });

  it('a rejected mandate does not cancel an active subscription held on another token', async () => {
    const ACTIVE_TOKEN = 'play-token-active-0';
    ledger.set(USER, {
      user_id: USER,
      tier: 'premium',
      gateway_subscription_id: ACTIVE_TOKEN,
      expires_at: IN_A_MONTH,
      auto_renew: false, // cancelled but paid up — the "Resubscribe" case
    });

    mockGetSubscriptionPurchase.mockResolvedValueOnce(playState('SUBSCRIPTION_STATE_PENDING'));
    await verify(USER, TOKEN);
    expect(ledger.get(USER)?.gateway_subscription_id).toBe(ACTIVE_TOKEN);

    mockGetSubscriptionPurchase.mockResolvedValueOnce(
      playState('SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED'),
    );
    await rtdn(TOKEN, 20);

    expect(ledger.get(USER)).toMatchObject({ tier: 'premium', gateway_subscription_id: ACTIVE_TOKEN });
    expect(pending.has(TOKEN)).toBe(false);
    expect(mockSendPaymentEvent).not.toHaveBeenCalled();
  });

  it('a still-pending RTDN re-read keeps the binding for later', async () => {
    mockGetSubscriptionPurchase.mockResolvedValue(playState('SUBSCRIPTION_STATE_PENDING'));
    await verify(USER, TOKEN);

    const res = await rtdn(TOKEN, 4);

    expect(res.statusCode).toBe(200);
    expect(pending.get(TOKEN)?.user_id).toBe(USER);
    expect(ledger.has(USER)).toBe(false);
  });

  it('a pending token cannot be claimed by a second account', async () => {
    mockGetSubscriptionPurchase.mockResolvedValue(playState('SUBSCRIPTION_STATE_PENDING'));
    await verify(USER, TOKEN);

    const res = await verify('user-b', TOKEN);

    expect(res.statusCode).toBe(409);
    expect(pending.get(TOKEN)?.user_id).toBe(USER);
  });

  it('retrying verify for the same pending purchase is idempotent', async () => {
    mockGetSubscriptionPurchase.mockResolvedValue(playState('SUBSCRIPTION_STATE_PENDING'));
    await verify(USER, TOKEN);
    const res = await verify(USER, TOKEN);

    expect(res.statusCode).toBe(200);
    expect(res.json().data.pending).toBe(true);
    expect(pending.size).toBe(1);
  });
});

describe('existing paths still behave', () => {
  const USER = 'user-c';
  const TOKEN = 'play-token-active-2';

  it('an immediately active purchase is granted and acknowledged with no pending row', async () => {
    mockGetSubscriptionPurchase.mockResolvedValue(playState('SUBSCRIPTION_STATE_ACTIVE'));

    const res = await verify(USER, TOKEN);

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ activated: true, pending: false, tier: 'premium' });
    expect(ledger.get(USER)?.gateway_subscription_id).toBe(TOKEN);
    expect(pending.size).toBe(0);
    expect(mockAcknowledge).toHaveBeenCalledWith(TOKEN);
  });

  it('an expiry RTDN for the token on the ledger still downgrades to free', async () => {
    mockGetSubscriptionPurchase.mockResolvedValueOnce(playState('SUBSCRIPTION_STATE_ACTIVE'));
    await verify(USER, TOKEN);

    mockGetSubscriptionPurchase.mockResolvedValueOnce(playState('SUBSCRIPTION_STATE_EXPIRED'));
    const res = await rtdn(TOKEN, 13 /* SUBSCRIPTION_EXPIRED */);

    expect(res.statusCode).toBe(200);
    expect(ledger.get(USER)).toMatchObject({
      tier: 'free',
      gateway_subscription_id: TOKEN,
      auto_renew: false,
    });
    expect(mockSendPaymentEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'subscription.cancelled' }),
    );
  });

  it('an RTDN for a token nobody has verified is acknowledged and ignored', async () => {
    const res = await rtdn('play-token-unknown', 4);

    expect(res.statusCode).toBe(200);
    expect(mockGetSubscriptionPurchase).not.toHaveBeenCalled();
    expect(ledger.size).toBe(0);
  });
});
