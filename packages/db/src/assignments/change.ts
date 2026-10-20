/**
 * The one way assignments are taken from or given back to players (plan
 * decision 5). Internal to the package: every repository path that adds or
 * removes access (assign, unassign, unlink, group membership, group and
 * repertoire delete) runs its change through `changeAssignments`.
 */
import { forkOfferExpiry, type ForkOfferReason } from '@mychess/domain';
import { and, eq, notInArray } from 'drizzle-orm';
import { z } from 'zod';
import type { Tx } from '../client';
import { assignmentPlayers, forkOffers } from '../assignment-schema';
import { accounts } from '../schema';
import { effectiveAssignments } from './effective';
import { openAt } from './offers';
import { takeSnapshot } from './snapshot';

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
}

const nameRowsSchema = z.array(z.object({ displayName: z.string() }));

/** Each player's live repertoire ids (not forked; R-128) from `coachId`. */
async function liveIdsOf(
  tx: Tx,
  playerIds: ReadonlySet<string>,
  coachId: string,
): Promise<Map<string, Set<string>>> {
  const ids = new Map<string, Set<string>>();
  for (const playerId of playerIds) {
    const live = await effectiveAssignments(tx, playerId);
    ids.set(
      playerId,
      new Set(
        live
          .filter((assignment) => assignment.coachId === coachId)
          .map((assignment) => assignment.repertoireId),
      ),
    );
  }
  return ids;
}

async function coachName(tx: Tx, coachId: string): Promise<string> {
  const [row] = nameRowsSchema.parse(
    await tx
      .select({ displayName: accounts.displayName })
      .from(accounts)
      .where(eq(accounts.id, coachId)),
  );
  if (row === undefined) throw new Error('offerFork: the coach is gone');
  return row.displayName;
}

/** A 30-day offer to keep what the player had (R-44, R-45, R-130, R-131). */
async function offerFork(
  tx: Tx,
  playerId: string,
  repertoireId: string,
  { reason, now }: AssignmentChange,
): Promise<void> {
  const taken = await takeSnapshot(tx, playerId, repertoireId);
  // A caller deleting a repertoire unassigns it first (plan decision 5), so
  // the repertoire is still there for its snapshot.
  if (taken === undefined)
    throw new Error('offerFork: the repertoire is gone; unassign it first');
  const { repertoire, snapshot } = taken;
  await tx.insert(forkOffers).values({
    playerId,
    repertoireId,
    coachName: await coachName(tx, repertoire.ownerId),
    name: repertoire.name,
    side: repertoire.side,
    snapshot,
    reason,
    createdAt: now,
    expiresAt: forkOfferExpiry(now),
  });
}

/** The player has it again: their open offer for it closes (lead decision 4). */
async function closeOffers(
  tx: Tx,
  playerId: string,
  repertoireId: string,
  now: Date,
): Promise<void> {
  await tx
    .update(forkOffers)
    .set({ closedAt: now })
    .where(
      and(
        eq(forkOffers.playerId, playerId),
        eq(forkOffers.repertoireId, repertoireId),
        openAt(now),
      ),
    );
}

/**
 * Deletes the player's own state on every repertoire no assignment row
 * reaches them through any more, forked or not (plan decision 4).
 */
async function dropStaleState(tx: Tx, playerId: string): Promise<void> {
  const held = await effectiveAssignments(tx, playerId, { withForked: true });
  const ids = held.map((assignment) => assignment.repertoireId);
  await tx
    .delete(assignmentPlayers)
    .where(
      and(
        eq(assignmentPlayers.playerId, playerId),
        ids.length === 0
          ? undefined
          : notInArray(assignmentPlayers.repertoireId, ids),
      ),
    );
}

/** The repertoire ids one player had live before the change and after it. */
interface LiveIds {
  readonly liveBefore: ReadonlySet<string>;
  readonly liveAfter: ReadonlySet<string>;
}

async function settlePlayer(
  tx: Tx,
  playerId: string,
  { liveBefore, liveAfter }: LiveIds,
  change: AssignmentChange,
): Promise<void> {
  for (const id of liveBefore)
    if (!liveAfter.has(id)) await offerFork(tx, playerId, id, change);
  for (const id of liveAfter)
    if (!liveBefore.has(id)) await closeOffers(tx, playerId, id, change.now);
  await dropStaleState(tx, playerId);
}

/**
 * Reads which of `change.coachId`'s repertoires each of `change.playerIds`
 * has live, runs `apply`, reads again, writes a fork offer for each one lost and
 * closes the offer of each one regained. Call it inside the transaction
 * that makes the change; returns what `apply` returns.
 */
export async function changeAssignments<T>(
  tx: Tx,
  change: AssignmentChange,
  apply: () => Promise<T>,
): Promise<T> {
  const playerIds = new Set(change.playerIds);
  const before = await liveIdsOf(tx, playerIds, change.coachId);
  const result = await apply();
  const after = await liveIdsOf(tx, playerIds, change.coachId);
  for (const playerId of playerIds)
    await settlePlayer(
      tx,
      playerId,
      {
        liveBefore: before.get(playerId) ?? new Set<string>(),
        liveAfter: after.get(playerId) ?? new Set<string>(),
      },
      change,
    );
  return result;
}
