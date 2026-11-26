import { useFormatter, type DateTimeFormatOptions } from 'next-intl';
import { LONG_DATE, shortDateFormat } from '../lib/date-format';

/**
 * A `YYYY-MM-DD` calendar day at noon UTC, which is the same day in
 * Vilnius, the zone it is shown in.
 */
const noonOf = (day: string): Date => new Date(`${day}T12:00:00Z`);

/**
 * Writes a deadline, a `YYYY-MM-DD` calendar day (plan decision 10), as a
 * date in the page's language, in the shape `formatOf` gives that day (a
 * long date unless said).
 */
export function useDeadline(
  formatOf: (day: Date) => DateTimeFormatOptions = () => LONG_DATE,
): (day: string) => string {
  const format = useFormatter();
  return (day) => {
    const noon = noonOf(day);
    return format.dateTime(noon, formatOf(noon));
  };
}

/**
 * Writes a deadline with the month short ("Nov 30"), its year only when it
 * is not the year of `today` (`YYYY-MM-DD`, read on the server so the
 * server and the browser agree).
 */
export function useShortDeadline(today: string): (day: string) => string {
  const now = noonOf(today);
  return useDeadline((day) => shortDateFormat(day, now));
}
