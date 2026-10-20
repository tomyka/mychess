/**
 * A player's access to the repertoires they have by assignment, enforced in
 * the query (CLAUDE.md: decided in the domain, enforced again in queries).
 * The domain decides with canUseAssignment on effectiveAssignments; these
 * filters make the statement itself return nothing else. Internal to the
 * package.
 */
import { canUseAssignment } from '@mychess/domain';
import {
  and,
  eq,
  inArray,
  isNotNull,
  notInArray,
  or,
  type SQL,
} from 'drizzle-orm';
import type { Executor } from '../client';
import { assignmentPlayers, assignments } from '../assignment-schema';
import { groupMembers, repertoires } from '../schema';
import { effectiveAssignments, type EffectiveAssignment } from './effective';

/**
 * The repertoires an assignment row reaches `playerId` through (their own
 * row or a group they are in) and that they have not forked, as a filter
 * on `repertoires.id` (R-16, R-128).
 */
function liveFor(db: Executor, playerId: string): SQL | undefined {
  const theirGroups = db
    .select({ id: groupMembers.groupId })
    .from(groupMembers)
    .where(eq(groupMembers.playerId, playerId));
  const assigned = db
    .select({ id: assignments.repertoireId })
    .from(assignments)
    .where(
      or(
        eq(assignments.playerId, playerId),
        inArray(assignments.groupId, theirGroups),
      ),
    );
  const forked = db
    .select({ id: assignmentPlayers.repertoireId })
    .from(assignmentPlayers)
    .where(
      and(
        eq(assignmentPlayers.playerId, playerId),
        isNotNull(assignmentPlayers.forkedAt),
      ),
    );
  return and(
    inArray(repertoires.id, assigned),
    notInArray(repertoires.id, forked),
  );
}

/** Repertoire `repertoireId` if it is live for `playerId`, as SQL. */
export const liveRepertoire = (
  db: Executor,
  playerId: string,
  repertoireId: string,
): SQL | undefined =>
  and(eq(repertoires.id, repertoireId), liveFor(db, playerId));

/** Does canUseAssignment let the player use this effective assignment? */
const usable = (assignment: EffectiveAssignment): boolean =>
  canUseAssignment({
    assigned: true,
    forked: assignment.forkedAt !== null,
  }).ok;

/**
 * The player's effective assignments canUseAssignment lets them use
 * (assigned now, not forked), by repertoire id.
 */
export async function usableAssignments(
  db: Executor,
  playerId: string,
): Promise<EffectiveAssignment[]> {
  const held = await effectiveAssignments(db, playerId, { withForked: true });
  return held.filter(usable);
}

/** The player's usable assignment of `repertoireId`, else undefined. */
export async function usableAssignment(
  db: Executor,
  playerId: string,
  repertoireId: string,
): Promise<EffectiveAssignment | undefined> {
  const usableOnes = await usableAssignments(db, playerId);
  return usableOnes.find((a) => a.repertoireId === repertoireId);
}
