/**
 * Which of a player's repertoires their coach may see progress on (R-39,
 * R-42, R-155). Built on canCoachSee: nothing without an active link. A
 * repertoire the player shares with the coach, or one this coach assigned
 * them (reaching them now) that they have not forked. A forked one is the
 * player's own now.
 */
import { ok, refuse, type Result } from '@mychess/chess';
import { canUseAssignment, type AssignmentFacts } from './assignment';
import {
  ACCESS_REFUSALS,
  canCoachSee,
  type AccessRefusal,
  type CoachAccessFacts,
} from './coach-access';

/** canCoachSee's facts and this coach's assignments reaching the player. */
export interface CoachProgressFacts extends CoachAccessFacts {
  /** assignmentFacts of this coach and player, forked or not. */
  readonly assignments: readonly AssignmentFacts[];
}

/** This coach's assignments of this player; anyone else's never count. */
const assignmentsOf = (
  coachId: string,
  playerId: string,
  facts: CoachProgressFacts,
): readonly AssignmentFacts[] =>
  facts.assignments.filter(
    (a) => a.coachId === coachId && a.playerId === playerId,
  );

/** An active link between this coach and player: canCoachSee on the profile. */
const linkedTo = (
  coachId: string,
  playerId: string,
  facts: CoachAccessFacts,
): Result<undefined, AccessRefusal> =>
  canCoachSee(coachId, playerId, { kind: 'profile' }, facts);

/**
 * Whether `coachId` has an active link to `playerId` (never to oneself):
 * the gate before any of the player's progress is read.
 */
export const isCoachLinked = (
  coachId: string,
  playerId: string,
  facts: CoachAccessFacts,
): boolean => linkedTo(coachId, playerId, facts).ok;

/** An assignment of this repertoire: live (canUseAssignment), forked or none. */
function assignedAccess(
  assigned: AssignmentFacts | undefined,
): Result<undefined, AccessRefusal> {
  if (canUseAssignment(assigned).ok) return ok();
  return assigned !== undefined && assigned.forkedAt !== null
    ? refuse(ACCESS_REFUSALS.forked)
    : refuse(ACCESS_REFUSALS.notShared);
}

/** May `coachId` see `playerId`'s progress on `repertoireId`? */
export function canCoachSeeProgress(
  coachId: string,
  playerId: string,
  repertoireId: string,
  facts: CoachProgressFacts,
): Result<undefined, AccessRefusal> {
  const linked = linkedTo(coachId, playerId, facts);
  if (!linked.ok) return linked;
  if (facts.sharedRepertoireIds.has(repertoireId)) return ok();
  return assignedAccess(
    assignmentsOf(coachId, playerId, facts).find(
      (a) => a.repertoireId === repertoireId,
    ),
  );
}

/**
 * The repertoires whose training results count for "last trained"
 * (R-154): those the coach may see progress on, so training on a private
 * repertoire never shows, not even as a time.
 */
export function progressRepertoireIds(
  coachId: string,
  playerId: string,
  facts: CoachProgressFacts,
): ReadonlySet<string> {
  if (!isCoachLinked(coachId, playerId, facts)) return new Set();
  const live = assignmentsOf(coachId, playerId, facts)
    .filter((a) => canUseAssignment(a).ok)
    .map((a) => a.repertoireId);
  return new Set([...facts.sharedRepertoireIds, ...live]);
}
