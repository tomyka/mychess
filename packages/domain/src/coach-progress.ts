/**
 * Which of a player's repertoires their coach sees on the player page and
 * the group grid, and how (R-39, R-42, R-151, R-155). Built on canCoachSee:
 * nothing without an active link. A repertoire the player shares with the
 * coach, or one this coach assigned them (reaching them now) that they have
 * not forked, is granted: its progress shows. A forked one is the player's
 * own now: only its name and status show.
 */
import type { Result } from '@mychess/chess';
import { canUseAssignment, type AssignmentFacts } from './assignment';
import {
  canCoachSee,
  type AccessRefusal,
  type CoachAccessFacts,
} from './coach-access';

/**
 * A repertoire the player shares with this coach that is a fork of one of
 * this coach's repertoires (#328), and the repertoire it was forked from.
 */
export interface SharedFork {
  readonly repertoireId: string;
  /** The coach's repertoire it is the Fork of. */
  readonly sourceRepertoireId: string;
  /** When the Fork was made: the newest one is named. */
  readonly createdAt: Date;
}

/** canCoachSee's facts and this coach's assignments reaching the player. */
export interface CoachProgressFacts extends CoachAccessFacts {
  /** assignmentFacts of this coach and player, forked or not. */
  readonly assignments: readonly AssignmentFacts[];
  /**
   * The player's shared forks of this coach's repertoires, in any order.
   * Read only for shared repertoires, so an unshared fork is never among
   * them (R-39, R-43).
   */
  readonly sharedForks: readonly SharedFork[];
}

/** Where a repertoire on the player page comes from. */
export type ProgressSource = 'shared' | 'assigned';

/**
 * A repertoire the coach sees, and how: granted (its progress shows),
 * through the share or this coach's live assignment; or forked (its name
 * and status only). `assignment` is this coach's assignment behind it, for
 * the status; null for a shared one. A forked one names the player's fork
 * of it when the player shares that fork with this coach (#328), so the
 * page can link to it; null otherwise, never an unshared fork (R-43). A
 * shared one names, in `forkOf`, this coach's repertoire it is the player's
 * Fork of (#328, R-155), so the page can say whose own copy it is; null
 * when it is not one.
 */
export type ProgressRepertoire =
  | {
      readonly repertoireId: string;
      readonly kind: 'granted';
      readonly source: 'shared';
      readonly assignment: null;
      readonly forkOf: string | null;
    }
  | {
      readonly repertoireId: string;
      readonly kind: 'granted';
      readonly source: 'assigned';
      readonly assignment: AssignmentFacts;
    }
  | {
      readonly repertoireId: string;
      readonly kind: 'forked';
      readonly source: 'assigned';
      readonly assignment: AssignmentFacts;
      readonly sharedForkId: string | null;
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

/** Newest first; of two made at once, the greater id first. */
const newestFirst = (a: SharedFork, b: SharedFork): number =>
  b.createdAt.getTime() - a.createdAt.getTime() ||
  (a.repertoireId < b.repertoireId ? 1 : -1);

/**
 * The player's forks of this coach's repertoires they share with this
 * coach, only ones the share facts hold too (R-39, R-43).
 */
const sharedForksOf = (facts: CoachProgressFacts): SharedFork[] =>
  facts.sharedForks.filter((one) =>
    facts.sharedRepertoireIds.has(one.repertoireId),
  );

/**
 * The player's shared fork of `repertoireId` (sharedForksOf). The player
 * may fork an assignment again once it is assigned again (R-128): the
 * newest such Fork is named.
 */
const sharedForkOf = (
  repertoireId: string,
  facts: CoachProgressFacts,
): string | null =>
  sharedForksOf(facts)
    .filter((one) => one.sourceRepertoireId === repertoireId)
    .toSorted(newestFirst)[0]?.repertoireId ?? null;

/**
 * This coach's repertoire that the shared `repertoireId` is the player's
 * Fork of (sharedForksOf), or null when it is not one.
 */
const forkOf = (
  repertoireId: string,
  facts: CoachProgressFacts,
): string | null =>
  sharedForksOf(facts).find((one) => one.repertoireId === repertoireId)
    ?.sourceRepertoireId ?? null;

/** An assignment of this repertoire: granted when live, forked, or nothing. */
function assignedEntry(
  assignment: AssignmentFacts | undefined,
  facts: CoachProgressFacts,
): ProgressRepertoire | undefined {
  if (assignment === undefined) return undefined;
  const { repertoireId } = assignment;
  if (canUseAssignment(assignment).ok)
    return { repertoireId, kind: 'granted', source: 'assigned', assignment };
  if (assignment.forkedAt === null) return undefined;
  return {
    repertoireId,
    kind: 'forked',
    source: 'assigned',
    assignment,
    sharedForkId: sharedForkOf(repertoireId, facts),
  };
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
      forkOf: forkOf(repertoireId, facts),
    };
  return assignedEntry(
    own.find((a) => a.repertoireId === repertoireId),
    facts,
  );
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
