/**
 * The one way assignments are taken from or given back to players (plan
 * decision 5). Internal to the package: every repository path that adds or
 * removes access (assign, unassign, unlink, group membership, group and
 * repertoire delete) runs its change through `changeAssignments`.
 */
import {
  forkOfferExpiry,
  settleAssignmentChange,
  type ForkOfferReason,
  type PlayerRepertoire,
} from '@mychess/domain';
import { and } from 'drizzle-orm';
import type { Tx } from '../client';
import { assignmentPlayers, forkOffers } from '../assignment-schema';
import { chunksOf, FORK_OFFER_CHUNK } from './batch';
import { namesOf } from './names';
import { openAt } from './offers';
import { inPairs, pairKey } from './pairs';
import { assignmentFacts, unreachedState } from './reach';
import { takeSnapshots, type Taken } from './snapshot';

export interface AssignmentChange {
  /**
   * The coach whose assignments the change touches, their account row
   * locked by the caller. Only their repertoires are offered or closed:
   * another coach's, changing concurrently under their own lock, are
   * theirs to settle.
   */
  readonly coachId: string;
  /** Every player the change may give or take a repertoire from; repeats count once. */
  readonly playerIds: readonly string[];
  /** Why a lost repertoire was lost, stored on its fork offer. */
  readonly reason: ForkOfferReason;
  readonly now: Date;
  /** The repertoire an assign gives: forked players have it live again (R-128). */
  readonly given?: string;
}

/** R-128, plan decision 8: the given repertoire is live again for them. */
async function unfork(
  tx: Tx,
  pairs: readonly PlayerRepertoire[],
): Promise<void> {
  if (pairs.length === 0) return;
  await tx
    .update(assignmentPlayers)
    .set({ forkedAt: null })
    .where(
      inPairs(
        assignmentPlayers.playerId,
        assignmentPlayers.repertoireId,
        pairs,
      ),
    );
}

/** Each lost pair's snapshot; a caller deleting a repertoire unassigns it first (plan decision 5). */
async function snapshotsOf(
  tx: Tx,
  pairs: readonly PlayerRepertoire[],
): Promise<(Taken & { readonly pair: PlayerRepertoire })[]> {
  const taken = await takeSnapshots(tx, pairs);
  return pairs.map((pair) => {
    const one = taken.get(pairKey(pair));
    if (one === undefined)
      throw new Error('snapshotsOf: the repertoire is gone; unassign it first');
    return { ...one, pair };
  });
}

/**
 * A 30-day offer to keep what the player had, one per lost pair in plan
 * order, inserted FORK_OFFER_CHUNK at a time (R-44, R-45, R-130, R-131).
 */
async function offerForks(
  tx: Tx,
  pairs: readonly PlayerRepertoire[],
  { reason, now }: AssignmentChange,
): Promise<void> {
  if (pairs.length === 0) return;
  const taken = await snapshotsOf(tx, pairs);
  const names = await namesOf(
    tx,
    taken.map((one) => one.repertoire.ownerId),
  );
  const rows = taken.map(({ pair, repertoire, snapshot }) => {
    const coachName = names.get(repertoire.ownerId);
    if (coachName === undefined)
      throw new Error('offerForks: the coach is gone');
    return {
      ...pair,
      coachName,
      name: repertoire.name,
      side: repertoire.side,
      snapshot,
      reason,
      createdAt: now,
      expiresAt: forkOfferExpiry(now),
    };
  });
  for (const chunk of chunksOf(rows, FORK_OFFER_CHUNK))
    await tx.insert(forkOffers).values(chunk);
}

/** The players have them again: their open offers close (lead decision 4). */
async function closeOffers(
  tx: Tx,
  pairs: readonly PlayerRepertoire[],
  now: Date,
): Promise<void> {
  if (pairs.length === 0) return;
  await tx
    .update(forkOffers)
    .set({ closedAt: now })
    .where(
      and(
        inPairs(forkOffers.playerId, forkOffers.repertoireId, pairs),
        openAt(now),
      ),
    );
}

/**
 * Deletes the players' own state on every repertoire no assignment row
 * reaches them through any more, forked or not (plan decision 4).
 */
async function dropStaleState(
  tx: Tx,
  playerIds: readonly string[],
): Promise<void> {
  if (playerIds.length === 0) return;
  await tx.delete(assignmentPlayers).where(unreachedState(tx, playerIds));
}

/**
 * Reads what `change.playerIds` have of `change.coachId`'s repertoires,
 * runs `apply`, reads again, and writes the domain's settlement: a fork
 * offer for each one lost, the offer of each one regained closed, and an
 * assign's forks cleared. Call it inside the transaction that makes the
 * change; returns what `apply` returns. A fixed number of statements
 * whatever the number of players, plus one repertoire load per lost
 * repertoire and one fork-offer insert per FORK_OFFER_CHUNK lost pairs.
 */
export async function changeAssignments<T>(
  tx: Tx,
  change: AssignmentChange,
  apply: () => Promise<T>,
): Promise<T> {
  const scope = { playerIds: change.playerIds, coachId: change.coachId };
  const before = await assignmentFacts(tx, scope);
  const result = await apply();
  const after = await assignmentFacts(tx, scope);
  const plan = settleAssignmentChange({
    coachId: change.coachId,
    playerIds: change.playerIds,
    before,
    after,
    given: change.given,
  });
  await unfork(tx, plan.unfork);
  await offerForks(tx, plan.offer, change);
  await closeOffers(tx, plan.close, change.now);
  await dropStaleState(tx, change.playerIds);
  return result;
}
