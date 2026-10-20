import { describe, expect, it } from 'vitest';
import { HOME_TIME_ZONE, vilniusDay } from './calendar';

describe('HOME_TIME_ZONE', () => {
  it('is Vilnius (CLAUDE.md)', () => {
    expect(HOME_TIME_ZONE).toBe('Europe/Vilnius');
  });
});

describe('vilniusDay', () => {
  it.each([
    ['in summer time (UTC+3)', '2026-10-24T21:30:00Z', '2026-10-25'],
    [
      'in summer time just before midnight',
      '2026-10-24T20:59:00Z',
      '2026-10-24',
    ],
    ['in winter time (UTC+2)', '2026-12-24T22:30:00Z', '2026-12-25'],
    [
      'in winter time just before midnight',
      '2026-12-24T21:59:00Z',
      '2026-12-24',
    ],
    ['with a zero-padded month and day', '2026-01-05T12:00:00Z', '2026-01-05'],
  ])('is the calendar day in Vilnius, not UTC, %s', (_, at, day) => {
    expect(vilniusDay(new Date(at))).toBe(day);
  });
});
