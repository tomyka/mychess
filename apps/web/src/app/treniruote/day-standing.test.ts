import { describe, expect, it } from 'vitest';
import { dayStanding } from './day-standing';

/** 10:00 in Vilnius on 25 October 2026, winter time. */
const NOW = new Date('2026-10-25T08:00:00Z');
const progress = (due: number, nextDue: Date | null) => ({
  reviewed: 50,
  due,
  toLearn: 4,
  nextDue,
});
const IN_TEN_MINUTES = new Date('2026-10-25T08:10:00Z');
/** 23:59 in Vilnius: still today. */
const LATE_TONIGHT = new Date('2026-10-25T21:59:00Z');
/** Midnight in Vilnius: tomorrow. */
const MIDNIGHT = new Date('2026-10-25T22:00:00Z');

describe('where the day stands after a session', () => {
  it('names the moves still due now, whatever comes later (R-62)', () => {
    expect(dayStanding(progress(46, MIDNIGHT), NOW)).toEqual({
      kind: 'due',
      count: 46,
    });
    expect(dayStanding(progress(1, null), NOW)).toEqual({
      kind: 'due',
      count: 1,
    });
  });

  it('names the next review when one comes back later today (R-78)', () => {
    expect(dayStanding(progress(0, IN_TEN_MINUTES), NOW)).toEqual({
      kind: 'laterToday',
      next: IN_TEN_MINUTES,
    });
    expect(dayStanding(progress(0, LATE_TONIGHT), NOW)).toEqual({
      kind: 'laterToday',
      next: LATE_TONIGHT,
    });
  });

  it('says the day is done when nothing comes back before midnight in Vilnius', () => {
    expect(dayStanding(progress(0, MIDNIGHT), NOW)).toEqual({
      kind: 'dayDone',
      next: MIDNIGHT,
    });
    expect(dayStanding(progress(0, null), NOW)).toEqual({
      kind: 'dayDone',
      next: null,
    });
  });
});
