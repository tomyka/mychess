import { renderHook } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../i18n/locales';
import { reviewWhen, useReviewTime } from './review-time';

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
    ['23 h 29 min', 23 * HOUR + 29 * MINUTE, 23],
  ])('counts hours %s ahead', (_, ms, count) => {
    expect(reviewWhen(after(NOON, ms), NOON)).toEqual({ kind: 'hours', count });
  });

  it.each([
    ['23 h 30 min', 23 * HOUR + 30 * MINUTE],
    ['just under a day', 24 * HOUR - MINUTE],
    ['exactly a day', 24 * HOUR],
  ])('names tomorrow, never "in 24 h", %s ahead (UX sign-off)', (_, ms) => {
    expect(reviewWhen(after(NOON, ms), NOON)).toEqual({ kind: 'tomorrow' });
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

describe('useReviewTime (#330 decision 6)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** How the hook words `when`, in `locale`, seen at `now`. */
  function worded(locale: 'lt' | 'en', now: Date, when: Date): string {
    vi.useFakeTimers({ now, toFake: ['Date'] });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(NextIntlClientProvider, {
        locale,
        messages: MESSAGES[locale],
        timeZone: 'Europe/Vilnius',
        children,
      });
    const { result } = renderHook(() => useReviewTime(), { wrapper });
    return result.current(when);
  }

  /** 16:18 in Vilnius on 27 October 2026 (UTC+2). */
  const AFTERNOON = new Date('2026-10-27T14:18:00Z');

  it.each([
    ['en', 'tomorrow at 16:18'],
    ['lt', 'rytoj 16:18'],
  ] as const)('writes tomorrow on a 24-hour clock in %s', (locale, text) => {
    expect(worded(locale, NOON, AFTERNOON)).toBe(text);
  });

  it.each([
    ['en', 'October 29 at 16:18'],
    ['lt', 'spalio 29 d. 16:18'],
  ] as const)(
    'leaves the year out of a date this year in %s',
    (locale, text) => {
      expect(worded(locale, NOON, after(AFTERNOON, 2 * 24 * HOUR))).toBe(text);
    },
  );

  it.each([
    ['en', 'January 5, 2027 at 12:00'],
    ['lt', '2027 m. sausio 5 d. 12:00'],
  ] as const)(
    'gives the year of a review due next year in %s',
    (locale, text) => {
      const december = new Date('2026-12-20T10:00:00Z');
      expect(worded(locale, december, new Date('2027-01-05T10:00:00Z'))).toBe(
        text,
      );
    },
  );
});
