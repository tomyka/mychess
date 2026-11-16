/**
 * The broadcast runner's job for one queued tournament (#349, spec
 * decisions 1 and 2): fetched once, when finished.
 *
 * Lichess is asked for the tournament first: only one with every round
 * finished is claimed, so a tournament still running is neither written
 * nor charged an attempt; it stays queued for a later night, as does one
 * Lichess refused to describe. Then, under the claim, its PGN streams into
 * one write with the tournament's own round ids (security M1), under the
 * runner's download limits; the Lichess gateway (lichess-broadcasts.ts)
 * arms their idle limit as the PGN's request is sent. A refused
 * or failed download is a failed attempt, as for a month; the PGN is
 * always closed. Log lines name the tournament, a public id, and a refusal
 * key or error name only, never the token.
 */
import {
  claimBroadcastTour,
  failBroadcastTour,
  releaseInterruptedBroadcastTours,
  writeBroadcastTour,
  type BroadcastTourClaim,
  type BroadcastTourWrite,
  type Executor,
} from '@mychess/db';
import {
  broadcastRoundIdSchema,
  type BroadcastRoundId,
  type BroadcastTourId,
} from '@mychess/domain';
import type { LichessBroadcastRefusal } from '@mychess/integrations';
import { withDownloadLimits, type RunnerLimits } from './broadcast-limits';
import type { LichessBroadcasts } from './lichess-broadcasts';

/** The tournament repositories the runner uses, on one database. */
export interface BroadcastTourIndex {
  claim: (
    tourId: BroadcastTourId,
    now: Date,
  ) => ReturnType<typeof claimBroadcastTour>;
  write: (write: BroadcastTourWrite) => ReturnType<typeof writeBroadcastTour>;
  fail: (
    claim: BroadcastTourClaim,
    now: Date,
  ) => ReturnType<typeof failBroadcastTour>;
  release: (
    processStartedAt: Date,
  ) => ReturnType<typeof releaseInterruptedBroadcastTours>;
}

/** The tournament repositories on `db`. */
export function broadcastTourIndexOn(db: Executor): BroadcastTourIndex {
  return {
    claim: (tourId, now) => claimBroadcastTour(db, tourId, now),
    write: (write) => writeBroadcastTour(db, write),
    fail: (claim, now) => failBroadcastTour(db, claim, now),
    release: (processStartedAt) =>
      releaseInterruptedBroadcastTours(db, processStartedAt),
  };
}

export interface TourJobDeps {
  readonly index: BroadcastTourIndex;
  /** What the job asks Lichess: a tournament's detail and its PGN. */
  readonly broadcasts: Pick<LichessBroadcasts, 'tour' | 'openPgn'>;
  readonly clock: () => Date;
  readonly limits: RunnerLimits;
}

const roundIdsSchema = broadcastRoundIdSchema.array();

/**
 * Fetches the queued tournament `tourId` into the index, once it has
 * finished. Throws, after recording the failed attempt, when the write or
 * the download fails.
 */
export async function processTour(
  deps: TourJobDeps,
  tourId: BroadcastTourId,
): Promise<void> {
  const detail = await deps.broadcasts.tour(tourId);
  if (!detail.ok) {
    console.error(
      `fide: broadcast tour ${tourId} skipped`,
      detail.refusal.reason,
    );
    return;
  }
  if (!detail.value.finished) return;
  const roundIds = roundIdsSchema.parse(
    detail.value.rounds.map((round) => round.id),
  );
  const claimed = await deps.index.claim(tourId, deps.clock());
  // Refused: another process holds it, or it needs nothing now.
  if (!claimed.ok) return;
  try {
    const refused = await indexTour(deps, claimed.value, roundIds);
    if (refused === undefined) return;
    await deps.index.fail(claimed.value, deps.clock());
    console.error(`fide: broadcast tour ${tourId} failed`, refused);
  } catch (error) {
    await deps.index.fail(claimed.value, deps.clock());
    throw error;
  }
}

/**
 * Streams the claimed tournament's PGN into its write; the refusal when
 * Lichess gave no PGN. A write refused because the claim was lost returns without
 * reading; the PGN is closed either way.
 */
function indexTour(
  deps: TourJobDeps,
  claim: BroadcastTourClaim,
  roundIds: readonly BroadcastRoundId[],
): Promise<LichessBroadcastRefusal['reason'] | undefined> {
  return withDownloadLimits(deps.limits, async (signal, idle) => {
    const opened = await deps.broadcasts.openPgn(claim.tourId, {
      signal,
      idle,
    });
    if (!opened.ok) return opened.refusal.reason;
    await using pgn = opened.value;
    idle.disarm();
    await deps.index.write({
      claim,
      roundIds,
      games: idle.watch(pgn.games),
      clock: deps.clock,
    });
    return undefined;
  });
}
