import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── What this covers ─────────────────────────────────────────────
// The ledger keeps Play's last reported state (migration 028) so the app can
// tell a user when Google could not charge their renewal. applyPlayEntitlement
// must write it on both paths, and only a grace period or account hold counts
// as a payment issue.

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock('../services/database', () => ({
  query: mocks.query,
  TABLES: {
    SUBSCRIPTION_LEDGER: 'subscription_ledger',
    PLAY_PENDING_PURCHASES: 'play_pending_purchases',
    TRANSACTIONS: 'transactions',
  },
}));
vi.mock('../services/premiumAccess', () => ({ invalidatePremiumCache: vi.fn() }));
vi.mock('../services/eventBus', () => ({ eventBus: { sendPaymentEvent: vi.fn() } }));
vi.mock('../services/redis', () => ({ getRedis: () => ({ del: vi.fn() }) }));

import { applyPlayEntitlement } from '../services/subscriptionEntitlement';
import { isPaymentIssueState } from '../services/playBilling';

function sub(overrides: Record<string, unknown> = {}) {
  return {
    entitled: true,
    expiresAt: new Date(Date.now() + 86_400_000),
    autoRenewing: true,
    needsAcknowledgement: false,
    state: 'SUBSCRIPTION_STATE_ACTIVE',
    isTestPurchase: false,
    orderId: null,
    ...overrides,
  } as any;
}

function ledgerWrite(): { sql: string; params: any[] } {
  const call = mocks.query.mock.calls.find(([sql]) => /subscription_ledger/.test(String(sql)));
  if (!call) throw new Error('no ledger write');
  return { sql: String(call[0]).replace(/\s+/g, ' '), params: call[1] };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.query.mockResolvedValue({ rows: [], rowCount: 1 });
});

describe('Play state on the ledger', () => {
  it('records the state when the user is entitled', async () => {
    await applyPlayEntitlement('u1', 't1', sub({ state: 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD' }));
    const { sql, params } = ledgerWrite();
    expect(sql).toContain('INSERT INTO subscription_ledger');
    expect(sql).toContain('play_state = $6');
    expect(params[5]).toBe('SUBSCRIPTION_STATE_IN_GRACE_PERIOD');
    // The columns the existing purchase tests rely on keep their positions
    expect(params.slice(0, 5)).toEqual(['u1', expect.any(Number), 't1', expect.any(Date), true]);
  });

  it('records the state when the user drops to free', async () => {
    await applyPlayEntitlement(
      'u1',
      't1',
      sub({ entitled: false, autoRenewing: false, state: 'SUBSCRIPTION_STATE_ON_HOLD' }),
    );
    const { sql, params } = ledgerWrite();
    expect(sql).toContain("UPDATE subscription_ledger SET tier = 'free'");
    expect(sql).toContain('play_state = $5');
    expect(params[4]).toBe('SUBSCRIPTION_STATE_ON_HOLD');
    expect(params[0]).toBe('u1');
    expect(params[3]).toBe('t1');
  });
});

describe('isPaymentIssueState', () => {
  it('is true only for a grace period or account hold', () => {
    expect(isPaymentIssueState('SUBSCRIPTION_STATE_IN_GRACE_PERIOD')).toBe(true);
    expect(isPaymentIssueState('SUBSCRIPTION_STATE_ON_HOLD')).toBe(true);
    for (const state of [
      'SUBSCRIPTION_STATE_ACTIVE',
      'SUBSCRIPTION_STATE_CANCELED',
      'SUBSCRIPTION_STATE_EXPIRED',
      'SUBSCRIPTION_STATE_PENDING',
      'SUBSCRIPTION_STATE_PAUSED',
      '',
      null,
      undefined,
    ]) {
      expect(isPaymentIssueState(state as any)).toBe(false);
    }
  });
});
