/**
 * Request limits counted per key in fixed windows, stored in our own
 * request_counters table (security A6): a counter keeps the requests
 * allowed in the current window and the time that window opened.
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
 * A sign-in magic link is mailed to one inbox at most five times an hour,
 * whichever client asks (#264), so many client addresses cannot flood one
 * inbox. Counted for every address, with an account or not, so the answer
 * never tells whether one exists; refused as the client-address limit is.
 */
export const MAGIC_LINK_EMAIL_RATE_LIMIT = {
  windowMs: 3_600_000,
  max: 5,
  reason: 'signIn.error.tooManyRequests',
} as const satisfies RateRule;

/** The one counter an account's previews and confirms share (R-119). */
export const importRateKey = (accountId: string): string =>
  `pgn-import:${accountId}`;

/**
 * The inbox a canonical email reaches: its local part without a plus
 * suffix, so `a+1@x` and `a+2@x` share one counter (#264). A plus that
 * starts the local part names no suffix and stays. Accounts are still keyed
 * by the whole canonical email.
 */
function inboxOf(canonicalEmail: string): string {
  const at = canonicalEmail.lastIndexOf('@');
  const plus = canonicalEmail.indexOf('+');
  if (plus <= 0 || plus > at) return canonicalEmail;
  return canonicalEmail.slice(0, plus) + canonicalEmail.slice(at);
}

/**
 * The counter of the links mailed to one inbox (#264), named by `digest` of
 * the inbox (a one-way hash the caller supplies), so the counter table never
 * holds an address.
 */
export const magicLinkEmailRateKey = (
  canonicalEmail: string,
  digest: (inbox: string) => string,
): string => `magic-link-email:${digest(inboxOf(canonicalEmail))}`;

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
