/**
 * The time a FIDE ID search covers (#349, spec decision 2): the months of
 * the month index (searchMonths, R-183), and after the newest of them the
 * weeks the dumps have not reached yet, which only broadcast tournaments
 * fill. All months are UTC months.
 */
import {
  BROADCAST_MONTH_RULES,
  broadcastMonthSchema,
  searchMonths,
} from './broadcast-month';
import type { BroadcastMonth } from './broadcast-month';

/** The oldest and the newest of the months a search covers. */
export interface BroadcastWindow {
  readonly oldest: BroadcastMonth;
  readonly newest: BroadcastMonth;
}

/**
 * The window of the 12 newest of the `published` dump months (R-183);
 * none while no month is published.
 */
export function broadcastWindow(
  published: readonly BroadcastMonth[],
): BroadcastWindow | null {
  const covered = searchMonths(published);
  const newest = covered[0];
  const oldest = covered.at(-1);
  return newest === undefined || oldest === undefined
    ? null
    : { oldest, newest };
}

/** The UTC month `at` falls in. */
export function monthOfInstant(at: Date): BroadcastMonth {
  return broadcastMonthSchema.parse(at.toISOString().slice(0, 7));
}

/** The first instant the window covers: its oldest month's first, in UTC. */
export function broadcastWindowStart(window: BroadcastWindow): Date {
  return new Date(`${window.oldest}-01T00:00:00Z`);
}

/** Whether `at` is in the window: in its oldest month or later. */
export function isWithinBroadcastWindow(
  at: Date,
  window: BroadcastWindow,
): boolean {
  return monthOfInstant(at) >= window.oldest;
}

/**
 * Whether `at` is after the end of the newest dump month, so no dump holds
 * a game played then yet.
 */
export function isAfterBroadcastDumps(
  at: Date,
  window: BroadcastWindow,
): boolean {
  return monthOfInstant(at) > window.newest;
}

/**
 * Whether `at` is before the window, so a search never covers it: the
 * nightly organiser listing stops paging once every tournament of a page
 * is (spec decision 3), judged by tourListingDate.
 */
export function isBeforeBroadcastWindow(
  at: Date,
  window: BroadcastWindow,
): boolean {
  return at.getTime() < broadcastWindowStart(window).getTime();
}

/**
 * The date an organiser's listed tournament is judged by against the
 * window (spec decision 3): its last round, or when it was created if
 * Lichess gives it no dates.
 */
export function tourListingDate(tour: {
  readonly lastRoundAt: Date | null;
  readonly createdAt: Date;
}): Date {
  return tour.lastRoundAt ?? tour.createdAt;
}

/**
 * The window the index is pruned to (#344): the search window of the
 * `published` months, but only once it spans all 12 months (R-183). A
 * shorter list, such as one Lichess served cut short, prunes nothing
 * rather than months a full list would still cover.
 *
 * Nor does an implausible list (security Low 1): one whose newest month is
 * after the month of `now`, which would move the window forward and prune
 * months still covered, or more than PRUNE_STALE_MONTHS before it, a
 * stale list. Months are UTC months.
 */
export function broadcastPruneWindow(
  published: readonly BroadcastMonth[],
  now: Date,
): BroadcastWindow | null {
  if (searchMonths(published).length !== BROADCAST_MONTH_RULES.searchMonths) {
    return null;
  }
  const window = broadcastWindow(published);
  const current = monthOfInstant(now);
  return window !== null &&
    window.newest <= current &&
    window.newest >= monthsBefore(now, PRUNE_STALE_MONTHS)
    ? window
    : null;
}

/** How many months the newest published month may lag before a prune. */
const PRUNE_STALE_MONTHS = 3;

/** The UTC month `count` months before the month of `at`. */
function monthsBefore(at: Date, count: number): BroadcastMonth {
  return monthOfInstant(
    new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() - count, 1)),
  );
}

/** Whether dump `month` is older than the window's oldest month. */
export function isMonthBeforeBroadcastWindow(
  month: BroadcastMonth,
  window: BroadcastWindow,
): boolean {
  return month < window.oldest;
}
