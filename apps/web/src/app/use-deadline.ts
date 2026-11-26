import { useFormatter, type DateTimeFormatOptions } from 'next-intl';
import { LONG_DATE } from '../lib/date-format';

/**
 * Writes a deadline, a `YYYY-MM-DD` calendar day (plan decision 10), as a
 * date in the page's language, in the shape `formatOf` gives that day (a
 * long date unless said). Read at noon UTC, which is the same day in
 * Vilnius, the zone it is shown in.
 */
export function useDeadline(
  formatOf: (day: Date) => DateTimeFormatOptions = () => LONG_DATE,
): (day: string) => string {
  const format = useFormatter();
  return (day) => {
    const noon = new Date(`${day}T12:00:00Z`);
    return format.dateTime(noon, formatOf(noon));
  };
}
