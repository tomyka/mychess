import { describe, expect, it } from 'vitest';
import { daysSince } from './days-ago';

// The day counting itself (DST, year end) is tested with `daysBetween` in
// packages/domain/src/calendar.test.ts.
describe('daysSince (a last-trained time that may be missing)', () => {
  const now = new Date('2026-10-26T09:00:00Z'); // 11:00 in Vilnius (EET)

  it('is null for never: null or undefined', () => {
    expect(daysSince(null, now)).toBeNull();
    expect(daysSince(undefined, now)).toBeNull();
  });

  it('is 0 earlier the same Vilnius day, though the UTC day before', () => {
    expect(daysSince(new Date('2026-10-25T22:30:00Z'), now)).toBe(0);
  });

  it('is the Vilnius days ago of a time', () => {
    expect(daysSince(new Date('2026-10-25T20:00:00Z'), now)).toBe(1);
  });
});
