'use client';

import { useFormatter } from 'next-intl';
import { DISPLAY_TIME_ZONE } from '../../lib/time-zone';

/** Writes when a review is due, in the display time zone and the user's locale. */
export function useReviewTime(): (when: Date) => string {
  const format = useFormatter();
  return (when) =>
    format.dateTime(when, {
      timeZone: DISPLAY_TIME_ZONE,
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
}
