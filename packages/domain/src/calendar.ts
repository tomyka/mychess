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

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

/** The wall clock in a time zone, to the second. */
interface WallClock {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

/** The wall clock `at` shows in `timeZone`. */
function wallClock(at: Date, timeZone: string): WallClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value);
  return {
    year: part('year'),
    month: part('month'),
    day: part('day'),
    hour: part('hour'),
    minute: part('minute'),
    second: part('second'),
  };
}

/** Minutes `timeZone` is ahead of UTC at `at`. */
function offsetMinutes(at: Date, timeZone: string): number {
  const c = wallClock(at, timeZone);
  const local = Date.UTC(
    c.year,
    c.month - 1,
    c.day,
    c.hour,
    c.minute,
    c.second,
  );
  // The wall clock drops milliseconds, so compare against whole seconds.
  const wholeSeconds = at.getTime() - at.getUTCMilliseconds();
  return Math.round((local - wholeSeconds) / MINUTE_MS);
}

/**
 * The instant the calendar day of `at` begins in `timeZone` (R-146): its
 * local midnight, at the offset in force then. The offset is read twice, so
 * a change of offset between UTC midnight and local midnight is followed.
 */
export function dayStart(at: Date, timeZone: string = HOME_TIME_ZONE): Date {
  const { year, month, day } = wallClock(at, timeZone);
  const midnightUtc = Date.UTC(year, month - 1, day);
  const guess =
    midnightUtc - offsetMinutes(new Date(midnightUtc), timeZone) * MINUTE_MS;
  return new Date(
    midnightUtc - offsetMinutes(new Date(guess), timeZone) * MINUTE_MS,
  );
}

/** The instant the next calendar day begins: days are 23 to 25 hours. */
export const dayEnd = (at: Date, timeZone: string = HOME_TIME_ZONE): Date =>
  dayStart(new Date(dayStart(at, timeZone).getTime() + 26 * HOUR_MS), timeZone);
