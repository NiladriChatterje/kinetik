import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── What this covers ─────────────────────────────────────────────
// Without Play's real-time notifications the hourly sweep is what keeps a
// weekly subscriber Premium after Google renews them. It must re-read due
// subscriptions from Play and apply them through applyPlayEntitlement (the
// webhook's path), acknowledge only after the entitlement is applied, only
// acknowledge recent purchases without rewriting them, and carry on past a
// Play error for one user.

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  getSubscriptionPurchase: vi.fn(),
  acknowledgeSubscription: vi.fn(),
  applyPlayEntitlement: vi.fn(),
  calls: [] as string[],
}));

vi.mock('../services/database', () => ({
  query: mocks.query,
  TABLES: { SUBSCRIPTION_LEDGER: 'subscription_ledger' },
}));

vi.mock('../services/playBilling', () => ({
  isPlayBillingConfigured: () => true,
  getSubscriptionPurchase: mocks.getSubscriptionPurchase,
  acknowledgeSubscription: mocks.acknowledgeSubscription,
}));

vi.mock('../services/subscriptionEntitlement', () => ({
  applyPlayEntitlement: mocks.applyPlayEntitlement,
}));

import { getDatabasePool } from '@kinetik/shared';
import {
  sweepSubscriptions, SWEEP_SQL, startSubscriptionSweep, SWEEP_INTERVAL_MS, SWEEP_MAX_GAP_MS,
} from '../services/subscriptionSweep';

const NEXT_WEEK = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

function playSub(overrides: Record<string, unknown> = {}) {
  return {
    entitled: true,
    expiresAt: NEXT_WEEK,
    autoRenewing: true,
    needsAcknowledgement: false,
    state: 'SUBSCRIPTION_STATE_ACTIVE',
    isTestPurchase: false,
    orderId: 'GPA.1234',
    ...overrides,
  };
}

function ledgerRows(rows: { user_id: string; purchase_token: string; due: boolean }[]) {
  mocks.query.mockResolvedValueOnce({ rows, rowCount: rows.length });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.calls.length = 0;
  mocks.applyPlayEntitlement.mockImplementation(async () => {
    mocks.calls.push('apply');
  });
  mocks.acknowledgeSubscription.mockImplementation(async () => {
    mocks.calls.push('ack');
  });
});

describe('subscription sweep', () => {
  it('only looks at Play-billed Premium rows', () => {
    const sql = SWEEP_SQL.replace(/\s+/g, ' ');
    expect(sql).toContain("tier = 'premium'");
    expect(sql).toContain('gateway_subscription_id IS NOT NULL');
    expect(sql).toContain("expires_at < NOW() + INTERVAL '1 hour'");
    expect(sql).toContain("updated_at > NOW() - INTERVAL '3 days'");
  });

  it('applies a renewal Play reports for a due subscription', async () => {
    ledgerRows([{ user_id: 'u1', purchase_token: 't1', due: true }]);
    const renewed = playSub();
    mocks.getSubscriptionPurchase.mockResolvedValueOnce(renewed);

    const result = await sweepSubscriptions();

    expect(mocks.getSubscriptionPurchase).toHaveBeenCalledWith('t1');
    expect(mocks.applyPlayEntitlement).toHaveBeenCalledWith('u1', 't1', renewed);
    expect(mocks.acknowledgeSubscription).not.toHaveBeenCalled();
    expect(result).toMatchObject({ checked: 1, renewed: 1, ended: 0, acknowledged: 0, failed: 0 });
  });

  it('applies an expiry Play reports for a due subscription', async () => {
    ledgerRows([{ user_id: 'u1', purchase_token: 't1', due: true }]);
    const expired = playSub({ entitled: false, state: 'SUBSCRIPTION_STATE_EXPIRED', autoRenewing: false });
    mocks.getSubscriptionPurchase.mockResolvedValueOnce(expired);

    const result = await sweepSubscriptions();

    expect(mocks.applyPlayEntitlement).toHaveBeenCalledWith('u1', 't1', expired);
    expect(mocks.acknowledgeSubscription).not.toHaveBeenCalled();
    expect(result).toMatchObject({ renewed: 0, ended: 1 });
  });

  it('acknowledges a due purchase only after applying it', async () => {
    ledgerRows([{ user_id: 'u1', purchase_token: 't1', due: true }]);
    mocks.getSubscriptionPurchase.mockResolvedValueOnce(playSub({ needsAcknowledgement: true }));

    const result = await sweepSubscriptions();

    expect(mocks.calls).toEqual(['apply', 'ack']);
    expect(mocks.acknowledgeSubscription).toHaveBeenCalledWith('t1');
    expect(result.acknowledged).toBe(1);
  });

  it('acknowledges a recent purchase without rewriting its ledger row', async () => {
    ledgerRows([{ user_id: 'u1', purchase_token: 't1', due: false }]);
    mocks.getSubscriptionPurchase.mockResolvedValueOnce(playSub({ needsAcknowledgement: true }));

    const result = await sweepSubscriptions();

    expect(mocks.applyPlayEntitlement).not.toHaveBeenCalled();
    expect(mocks.acknowledgeSubscription).toHaveBeenCalledWith('t1');
    expect(result).toMatchObject({ checked: 1, renewed: 0, ended: 0, acknowledged: 1 });
  });

  it('leaves an acknowledged recent purchase alone', async () => {
    ledgerRows([{ user_id: 'u1', purchase_token: 't1', due: false }]);
    mocks.getSubscriptionPurchase.mockResolvedValueOnce(playSub());

    await sweepSubscriptions();

    expect(mocks.applyPlayEntitlement).not.toHaveBeenCalled();
    expect(mocks.acknowledgeSubscription).not.toHaveBeenCalled();
  });

  it('never acknowledges a purchase Play no longer entitles', async () => {
    ledgerRows([{ user_id: 'u1', purchase_token: 't1', due: false }]);
    mocks.getSubscriptionPurchase.mockResolvedValueOnce(
      playSub({ entitled: false, needsAcknowledgement: true, state: 'SUBSCRIPTION_STATE_PENDING' }),
    );

    await sweepSubscriptions();

    expect(mocks.acknowledgeSubscription).not.toHaveBeenCalled();
  });

  it('keeps going past a Play error, leaving that row untouched', async () => {
    ledgerRows([
      { user_id: 'u1', purchase_token: 't1', due: true },
      { user_id: 'u2', purchase_token: 't2', due: true },
    ]);
    mocks.getSubscriptionPurchase
      .mockRejectedValueOnce(new Error('Play API 503'))
      .mockResolvedValueOnce(playSub());
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await sweepSubscriptions();

    expect(mocks.applyPlayEntitlement).toHaveBeenCalledTimes(1);
    expect(mocks.applyPlayEntitlement).toHaveBeenCalledWith('u2', 't2', expect.anything());
    expect(result).toMatchObject({ checked: 2, renewed: 1, failed: 1 });
    errorLog.mockRestore();
  });
});

// The schedule: hourly only while the database is in use (a connection was
// taken in the last two minutes), otherwise every five hours, so an idle
// free-tier database is not woken every hour. Runs are counted by the
// sweep's ledger query; database use by emitting the pool's 'acquire'.
describe('sweep schedule', () => {
  it('runs hourly while the database is in use, every five hours when idle, and retries a failure within the hour', async () => {
    vi.useFakeTimers();
    const MIN = 60 * 1000;
    const runs = () => mocks.query.mock.calls.length;
    const inUse = () => getDatabasePool().emit('acquire');
    mocks.query.mockResolvedValue({ rows: [], rowCount: 0 });
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

    startSubscriptionSweep();
    await vi.advanceTimersByTimeAsync(2 * MIN);
    expect(runs()).toBe(1); // first run, two minutes after start

    // Idle: nothing until five hours have passed, then it wakes the database
    await vi.advanceTimersByTimeAsync(SWEEP_MAX_GAP_MS - MIN);
    expect(runs()).toBe(1);
    await vi.advanceTimersByTimeAsync(MIN);
    expect(runs()).toBe(2);

    // In use, but less than an hour since the last run: no run
    await vi.advanceTimersByTimeAsync(30 * MIN);
    inUse();
    await vi.advanceTimersByTimeAsync(MIN);
    expect(runs()).toBe(2);

    // Over an hour, but the last use was half an hour ago: still no run
    await vi.advanceTimersByTimeAsync(29 * MIN);
    expect(runs()).toBe(2);

    // Over an hour and in use: runs, without waking anything
    inUse();
    await vi.advanceTimersByTimeAsync(MIN);
    expect(runs()).toBe(3);
    expect(SWEEP_INTERVAL_MS).toBe(60 * MIN);

    // A failed run (the database waking) is retried within the hour, idle or not
    mocks.query.mockRejectedValueOnce(new Error('database asleep'));
    await vi.advanceTimersByTimeAsync(SWEEP_MAX_GAP_MS);
    expect(runs()).toBe(4);
    await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS);
    expect(runs()).toBe(5);

    errorLog.mockRestore();
    vi.useRealTimers();
  });
});
