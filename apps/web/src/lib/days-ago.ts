import { daysBetween } from '@mychess/domain';

/**
 * Whole Vilnius days from a last-trained time to `now` (R-154); null where
 * there is none (never). Computed by a loader, so the server and the browser
 * render the same "last trained" text (spec, Database).
 */
export function daysSince(
  at: Date | null | undefined,
  now: Date,
): number | null {
  return at === null || at === undefined ? null : daysBetween(at, now);
}
