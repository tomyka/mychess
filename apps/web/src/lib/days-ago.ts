import { vilniusDay } from '@mychess/domain';

const DAY_MS = 86_400_000;

/**
 * Whole Vilnius days from `at` to `now`: 0 the same day, 1 the day before
 * (R-154). The calendar days are compared as UTC dates, so a DST change
 * between them does not shift the count. Computed by a loader, so the server
 * and the browser render the same "last trained" text (spec decision 6).
 */
export function daysAgo(at: Date, now: Date): number {
  return Math.round(
    (Date.parse(vilniusDay(now)) - Date.parse(vilniusDay(at))) / DAY_MS,
  );
}
