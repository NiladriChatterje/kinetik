import { describe, it, expect, vi } from 'vitest';
import { connectWithRetry, isTransientConnectError } from '@kinetik/shared';

// ─── Waiting for a sleeping database ────────────────────────────────
// The hosted Postgres takes 20-30 s to wake. Getting a connection is retried
// so requests wait instead of failing; nothing else is ever retried.

const wakeTimeout = () => new Error('Connection terminated due to connection timeout');
const fakeClient = { query: vi.fn(), release: vi.fn() } as any;
const noWait = vi.fn(async () => undefined);

describe('isTransientConnectError', () => {
  it('recognises wake-up and network blips', () => {
    expect(isTransientConnectError(wakeTimeout())).toBe(true);
    expect(isTransientConnectError(new Error('timeout exceeded when trying to connect'))).toBe(true);
    expect(isTransientConnectError(Object.assign(new Error('x'), { code: 'ECONNREFUSED' }))).toBe(true);
    expect(isTransientConnectError(Object.assign(new Error('the database system is starting up'), { code: '57P03' }))).toBe(true);
  });

  it('does not retry real errors such as a bad password or a broken query', () => {
    expect(isTransientConnectError(Object.assign(new Error('password authentication failed'), { code: '28P01' }))).toBe(false);
    expect(isTransientConnectError(Object.assign(new Error('duplicate key'), { code: '23505' }))).toBe(false);
    expect(isTransientConnectError(null)).toBe(false);
  });
});

describe('connectWithRetry', () => {
  it('returns at once when the database is awake', async () => {
    const pool = { connect: vi.fn().mockResolvedValue(fakeClient) };
    await expect(connectWithRetry(pool, noWait)).resolves.toBe(fakeClient);
    expect(pool.connect).toHaveBeenCalledTimes(1);
  });

  it('waits out a wake-up: two timeouts, then a connection', async () => {
    const pool = {
      connect: vi.fn()
        .mockRejectedValueOnce(wakeTimeout())
        .mockRejectedValueOnce(wakeTimeout())
        .mockResolvedValue(fakeClient),
    };
    const wait = vi.fn(async () => undefined);
    await expect(connectWithRetry(pool, wait)).resolves.toBe(fakeClient);
    expect(pool.connect).toHaveBeenCalledTimes(3);
    expect(wait.mock.calls.map((c) => (c as unknown[])[0])).toEqual([1000, 2000]);
  });

  it('gives up after three attempts with the last error', async () => {
    const pool = { connect: vi.fn().mockRejectedValue(wakeTimeout()) };
    await expect(connectWithRetry(pool, noWait)).rejects.toThrow('connection timeout');
    expect(pool.connect).toHaveBeenCalledTimes(3);
  });

  it('fails at once on an error that waiting will not fix', async () => {
    const badPassword = Object.assign(new Error('password authentication failed'), { code: '28P01' });
    const pool = { connect: vi.fn().mockRejectedValue(badPassword) };
    await expect(connectWithRetry(pool, noWait)).rejects.toBe(badPassword);
    expect(pool.connect).toHaveBeenCalledTimes(1);
  });
});
