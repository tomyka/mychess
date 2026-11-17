// The one place dates are given their shape (#330 decision 6): a 24-hour
// clock in every locale, in the display time zone, and on a date seen
// against now the year only when it is not the current one. A plain date
// always has its year.
import { vilniusDay } from '@mychess/domain';
import type { DateTimeFormatOptions } from 'next-intl';
import { DISPLAY_TIME_ZONE } from './time-zone';

/** A clock time, 24-hour in every locale. */
export const CLOCK: DateTimeFormatOptions = {
  timeZone: DISPLAY_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
};

/** A date with the month written out ("2026 m. spalio 16 d."). */
export const LONG_DATE: DateTimeFormatOptions = {
  timeZone: DISPLAY_TIME_ZONE,
  dateStyle: 'long',
};

/** A date with the month short ("2026-10-16", "Oct 16, 2026"). */
export const MEDIUM_DATE: DateTimeFormatOptions = {
  timeZone: DISPLAY_TIME_ZONE,
  dateStyle: 'medium',
};

/** The year of `when`, when it is not the year of `now` in the display time zone. */
const yearUnlessThis = (when: Date, now: Date): DateTimeFormatOptions =>
  vilniusDay(when).slice(0, 4) === vilniusDay(now).slice(0, 4)
    ? {}
    : { year: 'numeric' };

/** A date with its clock time, seen at `now`: the year only when it differs. */
export const dateTimeFormat = (
  when: Date,
  now: Date,
): DateTimeFormatOptions => ({
  ...CLOCK,
  month: 'long',
  day: 'numeric',
  ...yearUnlessThis(when, now),
});

/** A day with the month short, seen at `now`: the year only when it differs. */
export const shortDateFormat = (
  when: Date,
  now: Date,
): DateTimeFormatOptions => ({
  timeZone: DISPLAY_TIME_ZONE,
  month: 'short',
  day: 'numeric',
  ...yearUnlessThis(when, now),
});
