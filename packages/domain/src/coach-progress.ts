/**
 * Which of a player's repertoires their coach sees on the player page and
 * the group grid, and how (R-39, R-42, R-151, R-155). Built on canCoachSee:
 * nothing without an active link. A repertoire the player shares with the
 * coach, or one this coach assigned them (reaching them now) that they have
 * not forked, is granted: its progress shows. A forked one is the player's
 * own now: only its name and badges show.
 */
import type { Result } from '@mychess/chess';
import { canUseAssignment, type AssignmentFacts } from './assignment';
import {
  canCoachSee,
  type AccessRefusal,
  type CoachAccessFacts,
} from './coach-access';

/** canCoachSee's facts and this coach's assignments reaching the player. */
export interface CoachProgressFacts extends CoachAccessFacts {
  /** assignmentFacts of this coach and player, forked or not. */
  readonly assignments: readonly AssignmentFacts[];
}

/** Where a repertoire on the player page comes from. */
export type ProgressSource = 'shared' | 'assigned';

/**
 * A repertoire the coach sees, and how: granted (its progress shows),
 * through the share or this coach's live assignment; or forked (its name
 * and badges only). `assignment` is this coach's assignment behind it, for
 * the badges; null for a shared one.
 */
export type ProgressRepertoire =
  | {
      readonly repertoireId: string;
      readonly kind: 'granted';
      readonly source: 'shared';
      readonly assignment: null;
    }
  | {
      readonly repertoireId: string;
      readonly kind: 'granted' | 'forked';
      readonly source: 'assigned';
      readonly assignment: AssignmentFacts;
    };

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

/** An assignment of this repertoire: granted when live, forked, or nothing. */
function assignedEntry(
  assignment: AssignmentFacts | undefined,
): ProgressRepertoire | undefined {
  if (assignment === undefined) return undefined;
  const { repertoireId } = assignment;
  if (canUseAssignment(assignment).ok)
    return { repertoireId, kind: 'granted', source: 'assigned', assignment };
  return assignment.forkedAt === null
    ? undefined
    : { repertoireId, kind: 'forked', source: 'assigned', assignment };
}

/**
 * The entry of `repertoireId` once the link is known. The share comes
 * first: a forked repertoire the player also shares is shown as shared.
 */
function entryOf(
  repertoireId: string,
  facts: CoachProgressFacts,
  own: readonly AssignmentFacts[],
): ProgressRepertoire | undefined {
  if (facts.sharedRepertoireIds.has(repertoireId))
    return {
      repertoireId,
      kind: 'granted',
      source: 'shared',
      assignment: null,
    };
  return assignedEntry(own.find((a) => a.repertoireId === repertoireId));
}

/**
 * What `coachId` sees of `playerId`'s `repertoireId`: granted, forked, or
 * undefined (no link, oneself, or neither shared nor assigned by them).
 */
export function progressRepertoire(
  coachId: string,
  playerId: string,
  repertoireId: string,
  facts: CoachProgressFacts,
): ProgressRepertoire | undefined {
  if (!isCoachLinked(coachId, playerId, facts)) return undefined;
  return entryOf(repertoireId, facts, assignmentsOf(coachId, playerId, facts));
}

/**
 * Every repertoire the player page shows (R-151, R-155), each once: this
 * coach's assignments reaching the player (a forked one as forked), then
 * the shared ones. A repertoire both shared and assigned is listed once, as
 * shared. Empty without a link, and to oneself.
 */
export function progressRepertoires(
  coachId: string,
  playerId: string,
  facts: CoachProgressFacts,
): ProgressRepertoire[] {
  if (!isCoachLinked(coachId, playerId, facts)) return [];
  const own = assignmentsOf(coachId, playerId, facts);
  const assigned = own
    .filter((a) => a.reaches.length > 0)
    .map((a) => a.repertoireId)
    .filter((id) => !facts.sharedRepertoireIds.has(id));
  const ids = new Set([...assigned, ...facts.sharedRepertoireIds]);
  return [...ids].flatMap((id) => entryOf(id, facts, own) ?? []);
}

/**
 * The repertoires whose training results count for "last trained"
 * (R-154): the granted ones, so training on a private or forked
 * repertoire never shows, not even as a time.
 */
export function progressRepertoireIds(
  coachId: string,
  playerId: string,
  facts: CoachProgressFacts,
): ReadonlySet<string> {
  return new Set(
    progressRepertoires(coachId, playerId, facts)
      .filter((one) => one.kind === 'granted')
      .map((one) => one.repertoireId),
  );
}
