/**
 * The months of the Lichess broadcast dumps a FIDE ID search covers, and the
 * processing state of each month's index (#316, R-183, R-184).
 */
import { ok, refuse, type Result } from '@mychess/chess';
import { z } from 'zod';

/**
 * The timing rules of spec decision 2 and R-188, and the month count of
 * R-183.
 */
export const BROADCAST_MONTH_RULES = {
  searchMonths: 12,
  staleAfterMs: 15 * 60_000,
  maxAttempts: 3,
  retryAfterFailureMs: 10 * 60_000,
  failedRetryAfterMs: 24 * 60 * 60_000,
} as const;

/** Message-catalogue keys for the month refusals. */
export const BROADCAST_MONTH_REFUSALS = {
  claimLost: 'fide.monthClaimLost',
  notClaimable: 'fide.monthNotClaimable',
} as const;

export interface BroadcastMonthRefusal {
  readonly reason: (typeof BROADCAST_MONTH_REFUSALS)[keyof typeof BROADCAST_MONTH_REFUSALS];
}

/**
 * A dump month as `YYYY-MM`, as a regular expression source the database's
 * check constraint shares; the text order is the time order.
 */
export const BROADCAST_MONTH_PATTERN = '^[0-9]{4}-(0[1-9]|1[0-2])$';

export const broadcastMonthSchema = z
  .string()
  .regex(new RegExp(BROADCAST_MONTH_PATTERN), 'fide.monthInvalid')
  .brand<'BroadcastMonth'>();

export type BroadcastMonth = z.infer<typeof broadcastMonthSchema>;

/** A month index's states (spec decision 1). */
export const BROADCAST_MONTH_STATES = [
  'pending',
  'processing',
  'done',
  'failed',
] as const;

export type BroadcastMonthState = (typeof BROADCAST_MONTH_STATES)[number];

/**
 * A month's index state and its processing attempts so far; a pending
 * month also when its last attempt failed (null before any did), the
 * others when they entered the state: claimed, done or failed.
 */
export type BroadcastMonthStatus =
  | {
      readonly state: 'pending';
      readonly attempts: number;
      readonly lastFailedAt: Date | null;
    }
  | {
      readonly state: Exclude<BroadcastMonthState, 'pending'>;
      readonly attempts: number;
      readonly since: Date;
    };

/**
 * What a search does with a month: use its index, start processing it,
 * wait for the processing under way or for the pause after a failed
 * attempt (R-188), or go without it until a failed month may be retried.
 */
export type BroadcastMonthAction = 'use' | 'process' | 'wait' | 'unavailable';

/** The `n` newest of the published months, newest first (R-183). */
export function searchMonths(
  available: readonly BroadcastMonth[],
  n: number = BROADCAST_MONTH_RULES.searchMonths,
): BroadcastMonth[] {
  if (!Number.isInteger(n) || n < 1) {
    throw new RangeError(`month count ${String(n)} is not a positive integer`);
  }
  return [...new Set(available)].sort().reverse().slice(0, n);
}

/**
 * What a search does with `month` at `now` (spec decision 2). A processing
 * month left over 15 minutes is taken as a failed attempt at that moment:
 * its process crashed.
 */
export function nextBroadcastMonthAction(
  month: BroadcastMonthStatus,
  now: Date,
): BroadcastMonthAction {
  const current = withStaleFailed(month, now);
  switch (current.state) {
    case 'done':
      return 'use';
    case 'pending':
      return pendingAction(current, now);
    case 'processing':
      return 'wait';
    case 'failed':
      return elapsed(current, now) >= BROADCAST_MONTH_RULES.failedRetryAfterMs
        ? 'process'
        : 'unavailable';
  }
}

/**
 * Claims `month` for processing at `now` as one more attempt (spec decision
 * 3); refused when nextBroadcastMonthAction does not say to process it, as when another
 * process claimed it first.
 */
export function decideBroadcastClaim(
  month: BroadcastMonthStatus,
  now: Date,
): Result<BroadcastMonthStatus, BroadcastMonthRefusal> {
  if (nextBroadcastMonthAction(month, now) !== 'process') {
    return refuse(BROADCAST_MONTH_REFUSALS.notClaimable);
  }
  return ok({ state: 'processing', attempts: month.attempts + 1, since: now });
}

/**
 * A processing month whose attempt failed at `now`: pending for a search
 * 10 minutes later (R-188), or failed once it has used its three attempts
 * (spec decision 2).
 */
export function decideBroadcastFailure(
  month: BroadcastMonthStatus,
  now: Date,
): BroadcastMonthStatus {
  assertProcessing(month);
  return month.attempts >= BROADCAST_MONTH_RULES.maxAttempts
    ? { state: 'failed', attempts: month.attempts, since: now }
    : { state: 'pending', attempts: month.attempts, lastFailedAt: now };
}

/** A processing month whose games were all written at `now`. */
export function decideBroadcastFinish(
  month: BroadcastMonthStatus,
  now: Date,
): BroadcastMonthStatus {
  assertProcessing(month);
  return { state: 'done', attempts: month.attempts, since: now };
}

/**
 * Whether the process that claimed the month at `claimedAt` still holds
 * it (spec decision 3): the month is processing under that claim, not done,
 * failed or taken over by a later claim once it went stale.
 */
export function isBroadcastClaimHeld(
  month: BroadcastMonthStatus,
  claimedAt: Date,
): boolean {
  return (
    month.state === 'processing' &&
    month.since.getTime() === claimedAt.getTime()
  );
}

/** A pending month waits 10 minutes after a failed attempt (R-188). */
function pendingAction(
  month: Extract<BroadcastMonthStatus, { readonly state: 'pending' }>,
  now: Date,
): BroadcastMonthAction {
  return month.lastFailedAt === null ||
    now.getTime() - month.lastFailedAt.getTime() >=
      BROADCAST_MONTH_RULES.retryAfterFailureMs
    ? 'process'
    : 'wait';
}

function withStaleFailed(
  month: BroadcastMonthStatus,
  now: Date,
): BroadcastMonthStatus {
  if (
    month.state !== 'processing' ||
    elapsed(month, now) <= BROADCAST_MONTH_RULES.staleAfterMs
  ) {
    return month;
  }
  const staleAt = new Date(
    month.since.getTime() + BROADCAST_MONTH_RULES.staleAfterMs,
  );
  return decideBroadcastFailure(month, staleAt);
}

function elapsed(
  month: Extract<BroadcastMonthStatus, { readonly since: Date }>,
  now: Date,
): number {
  return now.getTime() - month.since.getTime();
}

function assertProcessing(month: BroadcastMonthStatus): void {
  if (month.state !== 'processing') {
    throw new RangeError(`a ${month.state} month is not being processed`);
  }
}
