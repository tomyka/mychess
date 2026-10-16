/**
 * How long after signing in a session stays fresh enough to link or unlink
 * a provider (R-84) or download the data export (R-95): a day. The auth
 * sets it as Better Auth's freshAge, so Better Auth's own checks agree.
 */
export const FRESH_AGE_SECONDS = 60 * 60 * 24;

const SECOND = 1000;

/** Did a session created at `createdAt` start less than a day before `now`? */
export function isFreshSession(
  createdAt: Date,
  now: Date = new Date(),
): boolean {
  return now.getTime() - createdAt.getTime() < FRESH_AGE_SECONDS * SECOND;
}
