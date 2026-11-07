import { describe, it, expect, vi, beforeEach } from 'vitest';

// The daily cleanup empties stored date plans whose day is over, with one
// statement, and never wakes the database: it runs only while the database
// is in use, at most once a day, retrying a failure an hour later.

const mocks = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('../services/database', () => ({
  query: mocks.query,
  TABLES: { MATCHES: 'matches' },
}));
// The same daily run also sweeps chat photos nobody saved (its own tests:
// chatPhotoDelivery.test.ts); here it only has to be called
vi.mock('../services/chatPhotoCleanup', () => ({ removeUnsavedChatPhotos: vi.fn(async () => 0) }));

import { getDatabasePool } from '@kinetik/shared';
import {
  cleanUpPastPlans, startPlanCleanup, PLAN_CLEANUP_SQL, PLAN_CLEANUP_EVERY_MS, PLAN_CLEANUP_RETRY_MS,
} from '../services/planCleanup';

describe('cleanUpPastPlans', () => {
  beforeEach(() => mocks.query.mockReset());

  it('empties only the plan, never the fixed date, with the same line as the read filter', () => {
    const sql = PLAN_CLEANUP_SQL.replace(/\s+/g, ' ');
    expect(sql).toContain('UPDATE matches SET planner_data = NULL');
    expect(sql).not.toContain('date_scheduled');
    // A day before yesterday (UTC), and only well-formed days
    expect(sql).toContain("(NOW() AT TIME ZONE 'UTC')::date - 1");
    expect(sql).toContain("planner_data->>'date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'");
  });

  it('reports how many plans were emptied', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [], rowCount: 3 });
    expect(await cleanUpPastPlans()).toBe(3);
    expect(mocks.query).toHaveBeenCalledWith(PLAN_CLEANUP_SQL);
  });
});

describe('cleanup schedule', () => {
  it('runs once a day while the database is in use, never wakes it, and retries a failure after an hour', async () => {
    vi.useFakeTimers();
    mocks.query.mockReset();
    mocks.query.mockResolvedValue({ rows: [], rowCount: 0 });
    const MIN = 60 * 1000;
    const runs = () => mocks.query.mock.calls.length;
    const inUse = () => getDatabasePool().emit('acquire');
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

    startPlanCleanup();

    // Idle: never runs, however long
    await vi.advanceTimersByTimeAsync(2 * PLAN_CLEANUP_EVERY_MS);
    expect(runs()).toBe(0);

    // In use: runs at the next check
    inUse();
    await vi.advanceTimersByTimeAsync(MIN);
    expect(runs()).toBe(1);

    // In use again within the day: no second run
    await vi.advanceTimersByTimeAsync(12 * 60 * MIN);
    inUse();
    await vi.advanceTimersByTimeAsync(MIN);
    expect(runs()).toBe(1);

    // A day later and in use: runs
    await vi.advanceTimersByTimeAsync(12 * 60 * MIN);
    inUse();
    await vi.advanceTimersByTimeAsync(MIN);
    expect(runs()).toBe(2);

    // A failure is retried an hour later, once the database is in use
    mocks.query.mockRejectedValueOnce(new Error('database asleep'));
    await vi.advanceTimersByTimeAsync(PLAN_CLEANUP_EVERY_MS);
    inUse();
    await vi.advanceTimersByTimeAsync(MIN);
    expect(runs()).toBe(3);
    await vi.advanceTimersByTimeAsync(PLAN_CLEANUP_RETRY_MS);
    inUse();
    await vi.advanceTimersByTimeAsync(MIN);
    expect(runs()).toBe(4);

    errorLog.mockRestore();
    vi.useRealTimers();
  });
});
