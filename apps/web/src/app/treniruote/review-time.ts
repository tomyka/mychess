'use client';

import {
  useFormatter,
  useTranslations,
  type DateTimeFormatOptions,
} from 'next-intl';
import { useSyncExternalStore } from 'react';
import { DISPLAY_TIME_ZONE } from '../../lib/time-zone';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/**
 * How a review's time is worded (docs/design/training-screen.md): within a
 * day as minutes or hours from now, else tomorrow or a date, with the clock
 * time.
 */
export type ReviewWhen =
  | { readonly kind: 'minutes' | 'hours'; readonly count: number }
  | { readonly kind: 'tomorrow' | 'later' };

/** The calendar day of `date` in the display time zone, as `YYYY-MM-DD`. */
const dayOf = (date: Date): string =>
  date.toLocaleDateString('en-CA', { timeZone: DISPLAY_TIME_ZONE });

/** The calendar day after `day` (`YYYY-MM-DD`). */
const dayAfter = (day: string): string =>
  new Date(Date.parse(`${day}T12:00:00Z`) + DAY).toISOString().slice(0, 10);

/** How to word a review due at `when`, seen at `now`. */
export function reviewWhen(when: Date, now: Date): ReviewWhen {
  const ahead = when.getTime() - now.getTime();
  if (ahead < DAY) {
    const minutes = Math.max(1, Math.round(ahead / MINUTE));
    return minutes < 60
      ? { kind: 'minutes', count: minutes }
      : { kind: 'hours', count: Math.round(minutes / 60) };
  }
  return dayOf(when) === dayAfter(dayOf(now))
    ? { kind: 'tomorrow' }
    : { kind: 'later' };
}

// The current minute, as a store the page reads: it changes once a minute,
// so a relative time stays true while the page is open. The server, and the
// browser while it hydrates, have no "now" of the reader's, so they show
// the date; the browser then words it relative to its own clock.
const subscribe = (onChange: () => void): (() => void) => {
  const timer = setInterval(onChange, MINUTE);
  return () => {
    clearInterval(timer);
  };
};
const currentMinute = (): number => Math.floor(Date.now() / MINUTE) * MINUTE;
const noMinute = (): null => null;

const LATER: ReviewWhen = { kind: 'later' };

/** The clock time, in the display time zone. */
const CLOCK: DateTimeFormatOptions = {
  timeZone: DISPLAY_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
};

/** Writes when a review is due, in the display time zone and the user's locale. */
export function useReviewTime(): (when: Date) => string {
  const t = useTranslations('training.when');
  const format = useFormatter();
  const now = useSyncExternalStore(subscribe, currentMinute, noMinute);
  return (when) => {
    const at = now === null ? LATER : reviewWhen(when, new Date(now));
    switch (at.kind) {
      case 'minutes':
      case 'hours':
        return t(at.kind, { count: at.count });
      case 'tomorrow':
        return t('tomorrow', { time: format.dateTime(when, CLOCK) });
      case 'later':
        return format.dateTime(when, {
          ...CLOCK,
          month: 'long',
          day: 'numeric',
        });
    }
  };
}
