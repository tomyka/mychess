import { describe, expect, it } from 'vitest';
import { reviewWhen } from './review-time';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** 12:00 in Vilnius on 26 October 2026, winter time (UTC+2). */
const NOON = new Date('2026-10-26T10:00:00Z');
/** 23:30 in Vilnius on 26 October 2026. */
const LATE = new Date('2026-10-26T21:30:00Z');

const after = (from: Date, ms: number): Date => new Date(from.getTime() + ms);

describe('reviewWhen', () => {
  it.each([
    ['30 seconds', 30_000, 1],
    ['45 minutes', 45 * MINUTE, 45],
    ['59 minutes', 59 * MINUTE, 59],
  ])('counts minutes %s ahead', (_, ms, count) => {
    expect(reviewWhen(after(NOON, ms), NOON)).toEqual({
      kind: 'minutes',
      count,
    });
  });

  it('says one minute for a review whose time has just passed', () => {
    expect(reviewWhen(after(NOON, -5 * MINUTE), NOON)).toEqual({
      kind: 'minutes',
      count: 1,
    });
  });

  it.each([
    ['an hour', 59 * MINUTE + 40_000, 1],
    ['3 hours', 3 * HOUR, 3],
    ['3 h 20 min', 3 * HOUR + 20 * MINUTE, 3],
    ['3 h 40 min', 3 * HOUR + 40 * MINUTE, 4],
    ['just under a day', 24 * HOUR - MINUTE, 24],
  ])('counts hours %s ahead', (_, ms, count) => {
    expect(reviewWhen(after(NOON, ms), NOON)).toEqual({ kind: 'hours', count });
  });

  it('names tomorrow, in Vilnius days, a day or more ahead', () => {
    expect(reviewWhen(after(NOON, 24 * HOUR), NOON)).toEqual({
      kind: 'tomorrow',
    });
    // 00:30 on the 28th in Vilnius, though still the 27th in UTC.
    expect(reviewWhen(after(LATE, 24 * HOUR), LATE)).toEqual({
      kind: 'tomorrow',
    });
  });

  it('gives a date to a review after tomorrow', () => {
    // 00:30 on the 28th in Vilnius: the 27th in UTC.
    expect(reviewWhen(after(LATE, 25 * HOUR), LATE)).toEqual({
      kind: 'later',
    });
    expect(reviewWhen(after(NOON, 3 * 24 * HOUR), NOON)).toEqual({
      kind: 'later',
    });
  });

  it('crosses a month end', () => {
    const lastDay = new Date('2026-10-31T10:00:00Z');
    expect(reviewWhen(after(lastDay, 30 * HOUR), lastDay)).toEqual({
      kind: 'tomorrow',
    });
  });
});
