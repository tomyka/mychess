import { describe, expect, it } from 'vitest';
import { daysAgo, daysSince } from './days-ago';

describe('daysAgo (Vilnius days, R-154)', () => {
  const now = new Date('2026-10-26T09:00:00Z'); // 11:00 in Vilnius (EET)

  it('is 0 for the same instant', () => {
    expect(daysAgo(now, now)).toBe(0);
  });

  it('is 0 for earlier the same Vilnius day, though the UTC day before', () => {
    expect(daysAgo(new Date('2026-10-25T22:30:00Z'), now)).toBe(0);
  });

  it('is 1 for the Vilnius day before', () => {
    expect(daysAgo(new Date('2026-10-25T20:00:00Z'), now)).toBe(1);
  });

  it('counts whole days across the DST change', () => {
    expect(daysAgo(new Date('2026-10-20T09:00:00Z'), now)).toBe(6);
  });

  it('counts across a month and a year', () => {
    expect(daysAgo(new Date('2025-12-31T12:00:00Z'), now)).toBe(299);
  });
});

describe('daysSince (a last-trained time that may be missing)', () => {
  const now = new Date('2026-10-26T09:00:00Z');

  it('is null for never: null or undefined', () => {
    expect(daysSince(null, now)).toBeNull();
    expect(daysSince(undefined, now)).toBeNull();
  });

  it('is the Vilnius days ago of a time', () => {
    expect(daysSince(new Date('2026-10-25T20:00:00Z'), now)).toBe(1);
  });
});
