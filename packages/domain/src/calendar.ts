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

const SECOND_MS = 1000;
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

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

/** The local calendar day of `at` in `timeZone`, as its UTC midnight. */
function localDay(at: number, timeZone: string): number {
  const { year, month, day } = wallClock(new Date(at), timeZone);
  return Date.UTC(year, month - 1, day);
}

/**
 * The first whole second of `day` (a local day, as its UTC midnight), given
 * `before`, an instant of an earlier day, and `within`, one of `day`, both
 * whole seconds: a binary search over the seconds between them.
 */
function firstSecondOf(
  day: number,
  before: number,
  within: number,
  timeZone: string,
): number {
  let lo = before;
  let hi = within;
  while (hi - lo > SECOND_MS) {
    const mid = lo + Math.floor((hi - lo) / 2 / SECOND_MS) * SECOND_MS;
    if (localDay(mid, timeZone) < day) lo = mid;
    else hi = mid;
  }
  return hi;
}

/**
 * The instant the calendar day of `at` begins in `timeZone` (R-146): its
 * local midnight, at the offset in force then. The offset is read twice, so
 * a change of offset between UTC midnight and local midnight is followed.
 * Where the clocks skip local midnight (America/Sao_Paulo, 2018-11-04), the
 * day begins at the change: the first instant whose local day is that day.
 */
export function dayStart(at: Date, timeZone: string = HOME_TIME_ZONE): Date {
  const day = localDay(at.getTime(), timeZone);
  const offsetAt = (instant: number): number =>
    offsetMinutes(new Date(instant), timeZone) * MINUTE_MS;
  const guess = day - offsetAt(day);
  const start = day - offsetAt(guess);
  if (localDay(start, timeZone) === day) return new Date(start);
  // `start` fell in the day before; local midnight at its offset is in `day`.
  return new Date(firstSecondOf(day, start, day - offsetAt(start), timeZone));
}

/** The instant the next calendar day begins: days are 23 to 25 hours. */
export const dayEnd = (at: Date, timeZone: string = HOME_TIME_ZONE): Date =>
  dayStart(new Date(dayStart(at, timeZone).getTime() + 26 * HOUR_MS), timeZone);

/**
 * Whole local calendar days from `from` to `to` in `timeZone`: 0 on the same
 * local day, 1 the day before (R-154). The local days are compared as their
 * UTC midnights, so a DST change between them does not shift the count.
 */
export const daysBetween = (
  from: Date,
  to: Date,
  timeZone: string = HOME_TIME_ZONE,
): number =>
  Math.round(
    (localDay(to.getTime(), timeZone) - localDay(from.getTime(), timeZone)) /
      DAY_MS,
  );
