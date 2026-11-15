/**
 * The time a FIDE ID search covers (#349, spec decision 2): the months of
 * the month index (searchMonths, R-183), and after the newest of them the
 * weeks the dumps have not reached yet, which only broadcast tournaments
 * fill. All months are UTC months.
 */
import { broadcastMonthSchema, searchMonths } from './broadcast-month';
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
