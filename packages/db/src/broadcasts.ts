/**
 * The dump months of the FIDE ID search's broadcast index (#316): which
 * months are ready, the exclusive claim of a month to process it, the
 * one-transaction write of a month's games, a failed attempt and the
 * months a restart interrupted. The processing state is shared with the
 * tournaments (broadcast-index-state.ts), the games and the search with
 * them too (broadcast-game-store.ts).
 */
import {
  BROADCAST_MONTH_REFUSALS,
  ok,
  broadcastMonthSchema,
  type BroadcastMonth,
  type BroadcastMonthRefusal,
  type BroadcastMonthStatus,
  type Result,
} from '@mychess/domain';
import { eq, inArray } from 'drizzle-orm';
import {
  DEFAULT_WRITE_OPTIONS,
  writeIndexEntry,
  type BroadcastGameStream,
  type BroadcastWriteCount,
  type BroadcastWriteOptions,
} from './broadcast-game-store';
import {
  claimIndexEntry,
  failIndexEntry,
  parseIndexRows,
  releaseInterruptedEntries,
  type IndexStateStore,
} from './broadcast-index-state';
import { broadcastMonths } from './broadcast-schema';
import type { Executor } from './client';

/** A process's hold on a month it processes: the month and its claim time. */
export interface BroadcastMonthClaim {
  readonly month: BroadcastMonth;
  readonly claimedAt: Date;
}

/** A month and its index state. */
export interface BroadcastMonthEntry {
  readonly month: BroadcastMonth;
  readonly status: BroadcastMonthStatus;
}

/**
 * The games of a claimed month, from a list or a stream, and the clock that
 * says when the write finished: read once every game is in.
 */
export interface BroadcastMonthWrite {
  readonly claim: BroadcastMonthClaim;
  readonly games: BroadcastGameStream;
  readonly clock: () => Date;
}

const monthColumns = {
  key: broadcastMonths.month,
  state: broadcastMonths.state,
  attempts: broadcastMonths.attempts,
  claimedAt: broadcastMonths.claimedAt,
  failedAt: broadcastMonths.failedAt,
  processedAt: broadcastMonths.processedAt,
};

const monthStore: IndexStateStore<
  BroadcastMonth,
  BroadcastMonthRefusal['reason']
> = {
  keySchema: broadcastMonthSchema,
  refusals: BROADCAST_MONTH_REFUSALS,
  lock: (tx, month, skipLocked) =>
    tx
      .select(monthColumns)
      .from(broadcastMonths)
      .where(eq(broadcastMonths.month, month))
      .for('update', skipLocked ? { skipLocked: true } : {}),
  lockProcessing: (tx) =>
    tx
      .select(monthColumns)
      .from(broadcastMonths)
      .where(eq(broadcastMonths.state, 'processing'))
      .for('update', { skipLocked: true }),
  set: async (tx, month, columns) => {
    await tx
      .update(broadcastMonths)
      .set(columns)
      .where(eq(broadcastMonths.month, month));
  },
};

const toClaim = ({
  key,
  claimedAt,
}: {
  key: BroadcastMonth;
  claimedAt: Date;
}) => ({ month: key, claimedAt }) satisfies BroadcastMonthClaim;

const fromClaim = ({ month, claimedAt }: BroadcastMonthClaim) => ({
  key: month,
  claimedAt,
});

/**
 * The index state of each of `months`, in the order given; a month no
 * search has needed yet is pending with no attempts.
 */
export async function broadcastMonthStatuses(
  db: Executor,
  months: readonly BroadcastMonth[],
): Promise<BroadcastMonthEntry[]> {
  if (months.length === 0) return [];
  const rows = parseIndexRows(
    broadcastMonthSchema,
    await db
      .select(monthColumns)
      .from(broadcastMonths)
      .where(inArray(broadcastMonths.month, [...months])),
  );
  const known = new Map<string, BroadcastMonthStatus>(
    rows.map((row) => [row.key, row.status]),
  );
  return months.map((month) => ({
    month,
    status: known.get(month) ?? {
      state: 'pending',
      attempts: 0,
      lastFailedAt: null,
    },
  }));
}

/**
 * Claims `month` at `now` for this process to index (spec decision 3),
 * adding it pending first when no search needed it before. The row lock
 * decides between concurrent searches: one that finds the row locked, or
 * the month not to be processed (decideBroadcastClaim), is refused.
 */
export async function claimBroadcastMonth(
  db: Executor,
  month: BroadcastMonth,
  now: Date,
): Promise<Result<BroadcastMonthClaim, BroadcastMonthRefusal>> {
  return db.transaction(async (tx) => {
    await tx
      .insert(broadcastMonths)
      .values({ month, state: 'pending', attempts: 0 })
      .onConflictDoNothing();
    const claimed = await claimIndexEntry(tx, monthStore, month, now);
    return claimed.ok ? ok(toClaim(claimed.value)) : claimed;
  });
}

/**
 * Writes the games of a claimed month and marks it done, in one
 * transaction (writeIndexEntry). Refused, writing nothing, when the claim
 * is no longer held.
 */
export async function writeBroadcastMonth(
  db: Executor,
  { claim, games, clock }: BroadcastMonthWrite,
  options: BroadcastWriteOptions = DEFAULT_WRITE_OPTIONS,
): Promise<Result<BroadcastWriteCount, BroadcastMonthRefusal>> {
  return writeIndexEntry(
    db,
    monthStore,
    {
      claim: fromClaim(claim),
      source: { kind: 'month', month: claim.month },
      games,
      accepts: () => true,
      clock,
    },
    options,
  );
}

/**
 * Records at `now` that the claimed month's processing failed: pending
 * again, or failed after its last attempt (decideBroadcastFailure). Refused
 * when the claim is no longer held.
 */
export async function failBroadcastMonth(
  db: Executor,
  claim: BroadcastMonthClaim,
  now: Date,
): Promise<Result<BroadcastMonthStatus, BroadcastMonthRefusal>> {
  return failIndexEntry(db, monthStore, fromClaim(claim), now);
}

/**
 * Makes the months a process before this one left processing pending
 * again without spending their attempt (#355), once, when this process
 * starts at `processStartedAt` (releaseInterruptedEntries).
 */
export async function releaseInterruptedBroadcastMonths(
  db: Executor,
  processStartedAt: Date,
): Promise<number> {
  return releaseInterruptedEntries(db, monthStore, processStartedAt);
}
