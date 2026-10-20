/** The time zone dates are shown and decided in until accounts have one (CLAUDE.md). */
export const HOME_TIME_ZONE = 'Europe/Vilnius';

const DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: HOME_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The calendar day of `at` in Vilnius, as `YYYY-MM-DD` (plan decision 10). */
export const vilniusDay = (at: Date): string => DAY.format(at);
