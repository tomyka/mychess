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
