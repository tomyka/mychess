import { describe, expect, it } from 'vitest';
import { FRESH_AGE_SECONDS, isFreshSession } from './session-freshness';

const NOW = new Date('2026-10-17T12:00:00Z');
const hoursAgo = (hours: number): Date =>
  new Date(NOW.getTime() - hours * 60 * 60 * 1000);

describe('isFreshSession (R-84, R-95)', () => {
  it('is a day: Better Auth’s freshAge', () => {
    expect(FRESH_AGE_SECONDS).toBe(86_400);
  });

  it.each([
    ['just signed in', 0, true],
    ['signed in 23 hours ago', 23, true],
    ['signed in exactly a day ago', 24, false],
    ['signed in 25 hours ago', 25, false],
  ])('is %s: %s', (_, hours, fresh) => {
    expect(isFreshSession(hoursAgo(hours), NOW)).toBe(fresh);
  });
});
