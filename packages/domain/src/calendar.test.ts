import { describe, expect, it } from 'vitest';
import { HOME_TIME_ZONE, dayEnd, dayStart, vilniusDay } from './calendar';

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

const iso = (d: Date): string => d.toISOString();

describe('dayStart', () => {
  it.each([
    [
      'in summer time (UTC+3)',
      '2026-10-23T12:00:00Z',
      '2026-10-22T21:00:00.000Z',
    ],
    [
      'in winter time (UTC+2)',
      '2026-12-01T12:00:00Z',
      '2026-11-30T22:00:00.000Z',
    ],
    [
      'at the first instant of the day',
      '2026-12-01T22:00:00Z',
      '2026-12-01T22:00:00.000Z',
    ],
    [
      'at the last instant of the day',
      '2026-12-01T21:59:59.999Z',
      '2026-11-30T22:00:00.000Z',
    ],
    [
      'with milliseconds on the time',
      '2026-10-23T12:34:56.789Z',
      '2026-10-22T21:00:00.000Z',
    ],
    [
      'just after the clocks go back',
      '2026-10-25T05:00:00Z',
      '2026-10-24T21:00:00.000Z',
    ],
    [
      'just before the clocks go back',
      '2026-10-25T00:59:59Z',
      '2026-10-24T21:00:00.000Z',
    ],
    [
      'on the day the clocks go forward',
      '2026-03-29T12:00:00Z',
      '2026-03-28T22:00:00.000Z',
    ],
  ])('is when the Vilnius day of the time begins, %s', (_, at, start) => {
    expect(iso(dayStart(new Date(at)))).toBe(start);
  });

  it('follows the time zone it is given', () => {
    expect(iso(dayStart(new Date('2026-10-23T12:00:00Z'), 'UTC'))).toBe(
      '2026-10-23T00:00:00.000Z',
    );
  });

  it.each([
    ['in the middle of the day', '2018-11-04T15:00:00Z'],
    ['at the first instant of the day', '2018-11-04T03:00:00Z'],
  ])(
    'begins a day whose midnight the clocks skip when they go forward, %s',
    (_, at) => {
      // Sao Paulo went from UTC-3 to UTC-2 at local midnight: 01:00 local.
      expect(iso(dayStart(new Date(at), 'America/Sao_Paulo'))).toBe(
        '2018-11-04T03:00:00.000Z',
      );
    },
  );

  it('begins the day before a skipped midnight at its own midnight', () => {
    expect(
      iso(dayStart(new Date('2018-11-04T02:59:59Z'), 'America/Sao_Paulo')),
    ).toBe('2018-11-03T03:00:00.000Z');
  });
});

describe('dayEnd', () => {
  it.each([
    [
      'an ordinary summer day',
      '2026-10-23T12:00:00Z',
      '2026-10-23T21:00:00.000Z',
    ],
    [
      'an ordinary winter day',
      '2026-12-01T12:00:00Z',
      '2026-12-01T22:00:00.000Z',
    ],
    [
      'the 25-hour day the clocks go back',
      '2026-10-25T05:00:00Z',
      '2026-10-25T22:00:00.000Z',
    ],
    [
      'the 23-hour day the clocks go forward',
      '2026-03-29T12:00:00Z',
      '2026-03-29T21:00:00.000Z',
    ],
  ])('is when the next Vilnius day begins, on %s', (_, at, end) => {
    expect(iso(dayEnd(new Date(at)))).toBe(end);
  });

  it('follows the time zone it is given', () => {
    expect(iso(dayEnd(new Date('2026-10-23T12:00:00Z'), 'UTC'))).toBe(
      '2026-10-24T00:00:00.000Z',
    );
  });
});
