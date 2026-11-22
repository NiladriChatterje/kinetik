import { describe, it, expect, vi, beforeEach } from 'vitest';

// The database records the statement and answers with fixed counts.
// vi.hoisted: vi.mock below is hoisted above plain declarations.
const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(async (_sql: string, _params?: any[]): Promise<{ rows: any[]; rowCount: number }> => ({
    rows: [{ lifetime: 250, today: 7 }],
    rowCount: 1,
  })),
}));

vi.mock('../services/database', async () => {
  const shared = await vi.importActual<any>('@kinetik/shared');
  return { query: mockQuery, TABLES: shared.TABLES };
});

import { countLikes, likeAllowance } from '../services/likeAllowance';

describe('like allowance', () => {
  beforeEach(() => mockQuery.mockClear());

  it('free accounts are limited to 30 likes for life', () => {
    expect(likeAllowance(false, { lifetime: 12, today: 3 })).toEqual({ used: 12, limit: 30, period: 'lifetime' });
  });

  it('Premium is limited to 100 likes a day, with no lifetime total', () => {
    // 250 all-time likes do not matter, only today's count does
    expect(likeAllowance(true, { lifetime: 250000, today: 7 })).toEqual({ used: 7, limit: 100, period: 'day' });
  });

  it('counts likes and super likes, all-time and since midnight India time', async () => {
    const counts = await countLikes('user-1');
    expect(counts).toEqual({ lifetime: 250, today: 7 });

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("action IN ('like', 'super_like')");
    expect(sql).toContain('AT TIME ZONE $2::text');
    expect(params).toEqual(['user-1', 'Asia/Kolkata']);
  });

  it('reads zero when the user has never liked anyone', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    expect(await countLikes('user-2')).toEqual({ lifetime: 0, today: 0 });
  });
});
