import { describe, it, expect } from 'vitest';
import { isPlanDayOver } from '../services/planDay';

// 6 Nov 2026, 02:00 UTC (07:30 in India)
const now = new Date(Date.UTC(2026, 10, 6, 2, 0, 0));

describe('isPlanDayOver', () => {
  it('a day before yesterday (UTC) is over everywhere', () => {
    expect(isPlanDayOver('2026-11-04', now)).toBe(true);
    expect(isPlanDayOver('2026-10-30', now)).toBe(true);
    expect(isPlanDayOver('2025-12-31', now)).toBe(true);
  });

  it('yesterday, today and later are left to the app, which knows the local day', () => {
    expect(isPlanDayOver('2026-11-05', now)).toBe(false);
    expect(isPlanDayOver('2026-11-06', now)).toBe(false);
    expect(isPlanDayOver('2026-12-24', now)).toBe(false);
  });

  it('crosses month and year ends', () => {
    const newYear = new Date(Date.UTC(2027, 0, 1, 12, 0, 0));
    expect(isPlanDayOver('2026-12-30', newYear)).toBe(true);
    expect(isPlanDayOver('2026-12-31', newYear)).toBe(false);
  });

  it('a plan with no day, or a malformed one, is not over', () => {
    expect(isPlanDayOver(null, now)).toBe(false);
    expect(isPlanDayOver(undefined, now)).toBe(false);
    expect(isPlanDayOver('', now)).toBe(false);
    expect(isPlanDayOver('5 Nov', now)).toBe(false);
    expect(isPlanDayOver(20261104, now)).toBe(false);
  });
});
