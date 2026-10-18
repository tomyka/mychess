/**
 * Request limits counted per key, as Better Auth counts its own in the
 * rate_limits table (security A6): a counter keeps the requests since the
 * last quiet window and the time of the last one allowed.
 */
import type { Result } from '@mychess/chess';

/**
 * At most `max` requests, the count restarting after `windowMs` of quiet;
 * a request over it is refused with `reason`, a message-catalogue key.
 */
export interface RateRule<R extends string = string> {
  readonly windowMs: number;
  readonly max: number;
  readonly reason: R;
}

/** A key's stored count; `lastRequest` is epoch milliseconds. */
export interface RateCounter {
  readonly count: number;
  readonly lastRequest: number;
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
 * Better Auth's rule: a whole window since the last allowed request starts
 * the count again; otherwise a count at the maximum refuses.
 */
export function countRequest<R extends string>(
  counter: RateCounter | undefined,
  rule: RateRule<R>,
  now: number,
): Result<RateCounter, RateRefusal<R>> {
  if (counter === undefined || now - counter.lastRequest >= rule.windowMs) {
    return { ok: true, value: { count: 1, lastRequest: now } };
  }
  if (counter.count >= rule.max) {
    return { ok: false, refusal: { reason: rule.reason, limit: rule.max } };
  }
  return { ok: true, value: { count: counter.count + 1, lastRequest: now } };
}
