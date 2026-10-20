import { useFormatter } from 'next-intl';
import { DISPLAY_TIME_ZONE } from '../lib/time-zone';

/**
 * Writes a deadline, a `YYYY-MM-DD` calendar day (plan decision 10), as a
 * date in the page's language. Read at noon UTC, which is the same day in
 * Vilnius, the zone it is shown in.
 */
export function useDeadline(): (day: string) => string {
  const format = useFormatter();
  return (day) =>
    format.dateTime(new Date(`${day}T12:00:00Z`), {
      dateStyle: 'long',
      timeZone: DISPLAY_TIME_ZONE,
    });
}
