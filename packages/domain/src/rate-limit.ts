/**
 * Request limits counted per key in fixed windows, stored in Better Auth's
 * rate_limits table (security A6): a counter keeps the requests allowed in
 * the current window and the time that window opened.
 */
import type { Result } from '@mychess/chess';

/**
 * At most `max` requests in a window of `windowMs`; a request over it is
 * refused with `reason`, a message-catalogue key.
 */
export interface RateRule<R extends string = string> {
  readonly windowMs: number;
  readonly max: number;
  readonly reason: R;
}

/** A key's stored count; `windowStart` is epoch milliseconds. */
export interface RateCounter {
  readonly count: number;
  readonly windowStart: number;
}

/** A request over its rule's limit. */
export interface RateRefusal<R extends string = string> {
  readonly reason: R;
  readonly limit: number;
}

/** An account runs at most ten import previews or confirms a minute (R-119). */
export const IMPORT_RATE_LIMIT = {
  windowMs: 60_000,
  max: 10,
  reason: 'pgn.tooManyImports',
} as const satisfies RateRule;

/**
 * A sign-in magic link is mailed at most three times a minute per client
 * address (security A6). Better Auth counts it, as a custom rule whose
 * window is in seconds.
 */
export const MAGIC_LINK_RATE_LIMIT = { windowMs: 60_000, max: 3 } as const;

/**
 * The longest window of Better Auth 1.7's built-in rules: 10 s by default
 * and for sign-in, 60 s for password reset, verification email and the
 * magic-link plugin. Recheck when upgrading Better Auth.
 */
const BETTER_AUTH_LONGEST_WINDOW_MS = 60_000;

/**
 * How long a rate_limits row can still decide a request: the longest window
 * of any limit. A row whose last request (or, for our counters, window
 * start) is older only opens a new window, as no row would, so deleting it
 * changes no decision.
 */
export const RATE_LIMIT_RETENTION_MS = Math.max(
  BETTER_AUTH_LONGEST_WINDOW_MS,
  MAGIC_LINK_RATE_LIMIT.windowMs,
  IMPORT_RATE_LIMIT.windowMs,
);

/** The one counter an account's previews and confirms share (R-119). */
export const importRateKey = (accountId: string): string =>
  `pgn-import:${accountId}`;

/**
 * Counts a request at `now` (epoch milliseconds) against `counter` (none
 * yet: undefined): the counter to store when it is allowed, or the refusal.
 * A fixed window (R-119 "at most ten a minute"): a request a whole window
 * after the window opened opens a new one; otherwise a count at the maximum
 * refuses. Better Auth's own rule (a window of quiet since the last allowed
 * request) would refuse a steady pace under the maximum.
 */
export function countRequest<R extends string>(
  counter: RateCounter | undefined,
  rule: RateRule<R>,
  now: number,
): Result<RateCounter, RateRefusal<R>> {
  if (counter === undefined || now >= counter.windowStart + rule.windowMs) {
    return { ok: true, value: { count: 1, windowStart: now } };
  }
  if (counter.count >= rule.max) {
    return { ok: false, refusal: { reason: rule.reason, limit: rule.max } };
  }
  return {
    ok: true,
    value: { count: counter.count + 1, windowStart: counter.windowStart },
  };
}
