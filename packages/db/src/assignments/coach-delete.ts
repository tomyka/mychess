/**
 * R-49: when a coach deletes their account, every player with a live
 * assignment from them gets an automatic fork, in the deleting transaction
 * and before the cascade (plan decision 9). Internal to the package.
 */
import { and, eq, isNotNull } from 'drizzle-orm';
import type { Tx } from '../client';
import { assignments } from '../assignment-schema';
import { playerRowsSchema } from '../coach-queries';
import { groupMembers } from '../schema';
import { effectiveAssignments } from './effective';
import { forkAssignment, type ForkRequest } from './fork';

/** Every player an assignment row of `coachId` reaches, once each. */
async function playersOfCoach(tx: Tx, coachId: string): Promise<Set<string>> {
  const direct = playerRowsSchema.parse(
    await tx
      .select({ playerId: assignments.playerId })
      .from(assignments)
      .where(
        and(eq(assignments.coachId, coachId), isNotNull(assignments.playerId)),
      ),
  );
  const viaGroups = playerRowsSchema.parse(
    await tx
      .select({ playerId: groupMembers.playerId })
      .from(assignments)
      .innerJoin(groupMembers, eq(groupMembers.groupId, assignments.groupId))
      .where(eq(assignments.coachId, coachId)),
  );
  return new Set([...direct, ...viaGroups].map((row) => row.playerId));
}

/**
 * Each (player, repertoire) where the repertoire is `coachId`'s and live
 * for the player: assigned now and not forked (R-128).
 */
async function liveAssigneesOfCoach(
  tx: Tx,
  coachId: string,
): Promise<ForkRequest[]> {
  const live: ForkRequest[] = [];
  for (const playerId of await playersOfCoach(tx, coachId))
    for (const assignment of await effectiveAssignments(tx, playerId))
      if (assignment.coachId === coachId)
        live.push({ playerId, repertoireId: assignment.repertoireId });
  return live;
}

/**
 * Forks every live assignment of `coachId` for its player. The caller holds
 * the coach's account row and deletes it afterwards in the same
 * transaction; the forks carry the coach's display name, so they outlive it.
 */
export async function forkForDeletingCoach(
  tx: Tx,
  coachId: string,
  now: Date,
): Promise<void> {
  for (const req of await liveAssigneesOfCoach(tx, coachId))
    await forkAssignment(tx, req, now);
}
