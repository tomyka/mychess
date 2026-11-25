import { createFormatter } from 'next-intl';
import { describe, expect, it } from 'vitest';
import {
  CLOCK,
  dateTimeFormat,
  LONG_DATE,
  MEDIUM_DATE,
  shortDateFormat,
} from './date-format';

/** 16:18 in Vilnius on 16 October 2026 (summer time, UTC+3). */
const AFTERNOON = new Date('2026-10-16T13:18:00Z');
const NOW = new Date('2026-10-10T09:00:00Z');

describe('the shared date formats (#330 decision 6)', () => {
  it('writes a clock time on a 24-hour clock', () => {
    const text = createFormatter({ locale: 'en' }).dateTime(AFTERNOON, CLOCK);
    expect(text).toBe('16:18');
  });

  it('writes midnight as 00, not 24', () => {
    const midnight = new Date('2026-10-16T21:05:00Z');
    const text = createFormatter({ locale: 'en' }).dateTime(midnight, CLOCK);
    expect(text).toBe('00:05');
  });

  it('gives a date this year without the year, in Vilnius time', () => {
    const text = createFormatter({ locale: 'en' }).dateTime(
      AFTERNOON,
      dateTimeFormat(AFTERNOON, NOW),
    );
    expect(text).toContain('16:18');
    expect(text).toContain('October 16');
    expect(text).not.toContain('2026');
    expect(text).not.toMatch(/AM|PM/);
  });

  it('adds the year to a date in another year', () => {
    const later = new Date('2027-01-05T10:00:00Z');
    const text = createFormatter({ locale: 'en' }).dateTime(
      later,
      dateTimeFormat(later, NOW),
    );
    expect(text).toContain('2027');
    expect(text).toContain('12:00');
  });

  it('reads the year in Vilnius: New Year in Vilnius is still the old year in UTC', () => {
    const newYear = new Date('2026-12-31T22:30:00Z');
    const text = createFormatter({ locale: 'en' }).dateTime(
      newYear,
      dateTimeFormat(newYear, NOW),
    );
    expect(text).toContain('2027');
    expect(text).toContain('00:30');
  });

  it('gives a short date this year without the year, in Vilnius time', () => {
    const lateEvening = new Date('2026-10-16T21:30:00Z');
    expect(
      createFormatter({ locale: 'en' }).dateTime(
        lateEvening,
        shortDateFormat(lateEvening, NOW),
      ),
    ).toBe('Oct 17');
  });

  it('adds the year to a short date in another year', () => {
    const lastYear = new Date('2025-09-02T09:00:00Z');
    expect(
      createFormatter({ locale: 'en' }).dateTime(
        lastYear,
        shortDateFormat(lastYear, NOW),
      ),
    ).toBe('Sep 2, 2025');
  });

  it.each([
    [LONG_DATE, 'October 17, 2026'],
    [MEDIUM_DATE, 'Oct 17, 2026'],
  ])('writes a date with its year, in Vilnius time', (options, expected) => {
    const lateEvening = new Date('2026-10-16T21:30:00Z');
    const text = createFormatter({ locale: 'en' }).dateTime(
      lateEvening,
      options,
    );
    expect(text).toBe(expected);
  });
});
