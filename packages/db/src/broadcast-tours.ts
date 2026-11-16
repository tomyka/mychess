/**
 * The broadcast tournaments of the FIDE ID search's index (#349, spec
 * decision 1): queuing a tournament qualifyBroadcastTour allowed, the
 * tournaments a search covers and their states, and the claim, write,
 * failure and release a month has (broadcast-index-state.ts). Public data:
 * who pasted a tournament is not kept, and no account's export holds it.
 */
import {
  BROADCAST_TOUR_REFUSALS,
  broadcastTourIdSchema,
  broadcastWindowStart,
  ok,
  broadcastTourFieldsSchema,
  isGameOfTour,
  type BroadcastRoundId,
  type BroadcastTourClaimRefusal,
  type BroadcastTourId,
  type BroadcastTourStatus,
  type BroadcastWindow,
  type QueuedBroadcastTour,
  type Result,
} from '@mychess/domain';
import { asc, desc, eq, gte } from 'drizzle-orm';
import { z } from 'zod';
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
import { broadcastTours } from './broadcast-schema';
import type { Executor } from './client';

/** A process's hold on a tournament it processes. */
export interface BroadcastTourClaim {
  readonly tourId: BroadcastTourId;
  readonly claimedAt: Date;
}

/** A queued tournament and its index state. */
export interface BroadcastTourEntry {
  readonly tourId: BroadcastTourId;
  readonly name: string;
  readonly official: boolean;
  readonly lastRoundAt: Date;
  readonly status: BroadcastTourStatus;
}

/** The games of a claimed tournament and the clock read once all are in. */
export interface BroadcastTourWrite {
  readonly claim: BroadcastTourClaim;
  /** The tournament's own rounds, as Lichess lists them (isGameOfTour). */
  readonly roundIds: readonly BroadcastRoundId[];
  readonly games: BroadcastGameStream;
  readonly clock: () => Date;
}

const stateColumns = {
  key: broadcastTours.tourId,
  state: broadcastTours.state,
  attempts: broadcastTours.attempts,
  claimedAt: broadcastTours.claimedAt,
  failedAt: broadcastTours.failedAt,
  processedAt: broadcastTours.processedAt,
};

const tourStore: IndexStateStore<
  BroadcastTourId,
  BroadcastTourClaimRefusal['reason']
> = {
  keySchema: broadcastTourIdSchema,
  refusals: BROADCAST_TOUR_REFUSALS,
  lock: (tx, tourId, skipLocked) =>
    tx
      .select(stateColumns)
      .from(broadcastTours)
      .where(eq(broadcastTours.tourId, tourId))
      .for('update', skipLocked ? { skipLocked: true } : {}),
  lockProcessing: (tx) =>
    tx
      .select(stateColumns)
      .from(broadcastTours)
      .where(eq(broadcastTours.state, 'processing'))
      .for('update', { skipLocked: true }),
  set: async (tx, tourId, columns) => {
    await tx
      .update(broadcastTours)
      .set(columns)
      .where(eq(broadcastTours.tourId, tourId));
  },
};

const fromClaim = ({ tourId, claimedAt }: BroadcastTourClaim) => ({
  key: tourId,
  claimedAt,
});

/**
 * Queues `tour` pending, to be fetched once (spec decision 1). A tournament
 * already queued, from a list or a pasted link, is left as it is, whatever
 * its state. True when it was new.
 */
export async function queueBroadcastTour(
  db: Executor,
  tour: QueuedBroadcastTour,
): Promise<boolean> {
  const { id, name, official, lastRoundAt, origin } =
    broadcastTourFieldsSchema.parse(tour);
  const inserted = await db
    .insert(broadcastTours)
    .values({
      tourId: id,
      name,
      official,
      lastRoundAt,
      origin: origin.kind,
      organiser: origin.kind === 'organiser' ? origin.organiser : null,
      state: 'pending',
      attempts: 0,
    })
    .onConflictDoNothing({ target: broadcastTours.tourId })
    .returning({ tourId: broadcastTours.tourId });
  return inserted.length > 0;
}

const tourRowsSchema = z.array(
  z.object({
    tourId: broadcastTourIdSchema,
    name: z.string(),
    official: z.boolean(),
    lastRoundAt: z.date(),
  }),
);

/**
 * The queued tournaments whose last round is in `window`, newest last
 * round first, with their index states: what the runner picks from
 * (nextBroadcastMonthAction).
 */
export async function broadcastTourStatuses(
  db: Executor,
  window: BroadcastWindow,
): Promise<BroadcastTourEntry[]> {
  const rows = await db
    .select({
      ...stateColumns,
      tourId: broadcastTours.tourId,
      name: broadcastTours.name,
      official: broadcastTours.official,
      lastRoundAt: broadcastTours.lastRoundAt,
    })
    .from(broadcastTours)
    .where(gte(broadcastTours.lastRoundAt, broadcastWindowStart(window)))
    .orderBy(desc(broadcastTours.lastRoundAt), asc(broadcastTours.tourId));
  const statuses = parseIndexRows(broadcastTourIdSchema, rows);
  return tourRowsSchema.parse(rows).map((row, n) => {
    const status = statuses[n]?.status;
    if (status === undefined) throw new RangeError(`tour ${row.tourId}`);
    return { ...row, status };
  });
}

/**
 * Claims the queued tournament `tourId` at `now` for this process to fetch
 * (spec decision 3, as a month). Refused when it is not queued, its row is
 * locked, or it is not to be processed (decideBroadcastClaim).
 */
export async function claimBroadcastTour(
  db: Executor,
  tourId: BroadcastTourId,
  now: Date,
): Promise<Result<BroadcastTourClaim, BroadcastTourClaimRefusal>> {
  return db.transaction(async (tx) => {
    const claimed = await claimIndexEntry(tx, tourStore, tourId, now);
    return claimed.ok
      ? ok({ tourId: claimed.value.key, claimedAt: claimed.value.claimedAt })
      : claimed;
  });
}

/**
 * Writes the games of a claimed tournament and marks it done, in one
 * transaction (writeIndexEntry). Only the games of its own `roundIds` are
 * kept, the others skipped and counted (security M1, isGameOfTour). A game
 * link already stored, by a month or another tournament, keeps its first
 * source. Refused, writing nothing, when the claim is no longer held.
 */
export async function writeBroadcastTour(
  db: Executor,
  { claim, roundIds, games, clock }: BroadcastTourWrite,
  options: BroadcastWriteOptions = DEFAULT_WRITE_OPTIONS,
): Promise<Result<BroadcastWriteCount, BroadcastTourClaimRefusal>> {
  return writeIndexEntry(
    db,
    tourStore,
    {
      claim: fromClaim(claim),
      source: { kind: 'tour', tourId: claim.tourId },
      games,
      accepts: (game) => isGameOfTour(game.url, roundIds),
      clock,
    },
    options,
  );
}

/**
 * Records at `now` that the claimed tournament's processing failed, as for
 * a month (decideBroadcastFailure). Refused when the claim is no longer
 * held.
 */
export async function failBroadcastTour(
  db: Executor,
  claim: BroadcastTourClaim,
  now: Date,
): Promise<Result<BroadcastTourStatus, BroadcastTourClaimRefusal>> {
  return failIndexEntry(db, tourStore, fromClaim(claim), now);
}

/**
 * Makes the tournaments a process before this one left processing pending
 * again without spending their attempt (#355), once, when this process
 * starts at `processStartedAt` (releaseInterruptedEntries).
 */
export async function releaseInterruptedBroadcastTours(
  db: Executor,
  processStartedAt: Date,
): Promise<number> {
  return releaseInterruptedEntries(db, tourStore, processStartedAt);
}
