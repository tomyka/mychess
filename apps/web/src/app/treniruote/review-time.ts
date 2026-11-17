'use client';

import { vilniusDay } from '@mychess/domain';
import { useFormatter, useTranslations } from 'next-intl';
import { useSyncExternalStore } from 'react';
import { CLOCK, dateTimeFormat } from '../../lib/date-format';
import { noSnapshot } from '../../lib/external-store';

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

/** The calendar day after `day` (`YYYY-MM-DD`). */
const dayAfter = (day: string): string =>
  new Date(Date.parse(`${day}T12:00:00Z`) + DAY).toISOString().slice(0, 10);

/**
 * How to word a review due at `when`, seen at `now`: minutes, then hours
 * up to 23; what would round to 24 h or more is a day (UX sign-off, #330).
 */
export function reviewWhen(when: Date, now: Date): ReviewWhen {
  const minutes = Math.max(
    1,
    Math.round((when.getTime() - now.getTime()) / MINUTE),
  );
  if (minutes < 60) return { kind: 'minutes', count: minutes };
  const hours = Math.round(minutes / 60);
  if (hours < 24) return { kind: 'hours', count: hours };
  return vilniusDay(when) === dayAfter(vilniusDay(now))
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

const LATER: ReviewWhen = { kind: 'later' };

/** Writes when a review is due, in the display time zone and the user's locale. */
export function useReviewTime(): (when: Date) => string {
  const t = useTranslations('training.when');
  const format = useFormatter();
  const now = useSyncExternalStore(subscribe, currentMinute, noSnapshot);
  return (when) => {
    const at = now === null ? LATER : reviewWhen(when, new Date(now));
    switch (at.kind) {
      case 'minutes':
      case 'hours':
        return t(at.kind, { count: at.count });
      case 'tomorrow':
        return t('tomorrow', { time: format.dateTime(when, CLOCK) });
      case 'later':
        // While hydrating there is no "now": the year is left out, as the
        // server rendered it.
        return format.dateTime(
          when,
          dateTimeFormat(when, new Date(now ?? when.getTime())),
        );
    }
  };
}
