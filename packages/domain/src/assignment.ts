import type { Result } from '@mychess/chess';
import { z } from 'zod';
import { vilniusDay } from './calendar';
import { isCoach, type CoachState } from './coach';

/** Message-catalogue keys for assignment refusals; the UI translates them. */
export const ASSIGNMENT_REFUSALS = {
  notCoach: 'assignment.notCoach',
  notFound: 'assignment.notFound',
  notLinked: 'assignment.notLinked',
  groupNotFound: 'assignment.groupNotFound',
  alreadyAssigned: 'assignment.alreadyAssigned',
} as const;

export interface AssignmentRefusal {
  readonly reason: (typeof ASSIGNMENT_REFUSALS)[keyof typeof ASSIGNMENT_REFUSALS];
}

type AssignmentResult = Result<undefined, AssignmentRefusal>;

const OK: AssignmentResult = { ok: true, value: undefined };
const refuse = (reason: AssignmentRefusal['reason']): AssignmentResult => ({
  ok: false,
  refusal: { reason },
});

/** Whom an Assignment gives a repertoire to (R-15, R-16). */
export type AssignmentTarget =
  | { readonly kind: 'player'; readonly playerId: string }
  | { readonly kind: 'group'; readonly groupId: string };

/** What canAssign decides on, read in the assigning transaction. */
export interface AssignFacts extends CoachState {
  /** The repertoire's owner; undefined when there is no such repertoire. */
  readonly repertoireOwnerId: string | undefined;
  /** A linked player, or one of this coach's groups. */
  readonly targetAllowed: boolean;
  /** The repertoire is already assigned to this target. */
  readonly alreadyAssigned: boolean;
}

const targetRefusal = (
  target: AssignmentTarget,
): AssignmentRefusal['reason'] =>
  target.kind === 'player'
    ? ASSIGNMENT_REFUSALS.notLinked
    : ASSIGNMENT_REFUSALS.groupNotFound;

const isSelf = (coachId: string, target: AssignmentTarget): boolean =>
  target.kind === 'player' && target.playerId === coachId;

/**
 * A coach assigns only their own repertoire, only while in Coach mode, only
 * to a linked player or their own group, and once per target (plan
 * decision 1, lead decision 5). Someone else's repertoire reads as missing;
 * there is no link to oneself.
 */
export function canAssign(
  coachId: string,
  target: AssignmentTarget,
  facts: AssignFacts,
): AssignmentResult {
  if (!isCoach(facts)) return refuse(ASSIGNMENT_REFUSALS.notCoach);
  if (facts.repertoireOwnerId !== coachId) {
    return refuse(ASSIGNMENT_REFUSALS.notFound);
  }
  if (isSelf(coachId, target) || !facts.targetAllowed) {
    return refuse(targetRefusal(target));
  }
  return facts.alreadyAssigned
    ? refuse(ASSIGNMENT_REFUSALS.alreadyAssigned)
    : OK;
}

/** What changing one of a coach's assignments depends on, read under lock. */
export interface ChangeAssignmentFacts extends CoachState {
  /** The assignment exists and is this coach's own. */
  readonly found: boolean;
}

/**
 * A coach changes (moves or clears the deadline of) only their own
 * assignment, and only while in Coach mode (R-51, R-113). Another coach's
 * assignment reads as missing.
 */
export function canChangeAssignment(
  facts: ChangeAssignmentFacts,
): AssignmentResult {
  if (!isCoach(facts)) return refuse(ASSIGNMENT_REFUSALS.notCoach);
  return facts.found ? OK : refuse(ASSIGNMENT_REFUSALS.notFound);
}

/** Whom an existing assignment of the repertoire went to. */
export interface AssignedTarget {
  readonly kind: AssignmentTarget['kind'];
  readonly id: string;
}

/** The candidates still offered for one repertoire. */
export interface AssignableTargets<P, G> {
  readonly players: readonly P[];
  readonly groups: readonly G[];
}

/**
 * The coach's linked players and groups this repertoire is not yet
 * assigned to as that target, in their order: canAssign's alreadyAssigned
 * rule. A player who has it only through a group stays assignable
 * individually (R-16, R-134).
 */
export function assignableTargets<
  P extends { readonly id: string },
  G extends { readonly id: string },
>(
  players: readonly P[],
  groups: readonly G[],
  assigned: readonly AssignedTarget[],
): AssignableTargets<P, G> {
  const taken = (kind: AssignedTarget['kind']): ReadonlySet<string> =>
    new Set(assigned.flatMap((a) => (a.kind === kind ? [a.id] : [])));
  const takenPlayers = taken('player');
  const takenGroups = taken('group');
  return {
    players: players.filter((player) => !takenPlayers.has(player.id)),
    groups: groups.filter((group) => !takenGroups.has(group.id)),
  };
}

/** Message-catalogue keys for invalid assignment input. */
export const ASSIGNMENT_ISSUES = {
  deadlineInvalid: 'assignment.deadlineInvalid',
} as const;

/** A deadline: a calendar date, `YYYY-MM-DD` (plan decision 10). */
export const deadlineSchema = z.iso.date({
  error: ASSIGNMENT_ISSUES.deadlineInvalid,
});

/** One group assignment as one member has it. */
export interface GroupDeadline {
  readonly deadline: string | null;
  /** The member's join day in Vilnius. */
  readonly joinedDay: string;
}

/** Every assignment row through which a player has one repertoire. */
export interface DeadlineSources {
  /** Present when the player is assigned the repertoire individually. */
  readonly individual?: { readonly deadline: string | null };
  readonly groups: readonly GroupDeadline[];
}

const later = (a: string, b: string): string => (a > b ? a : b);
const earlier = (a: string, b: string): string => (a < b ? a : b);

/**
 * The deadline a player has: the individual one if assigned individually
 * (R-134); otherwise each group deadline moved to the join day if later
 * (R-16), the earliest of them; null when none has a deadline.
 */
export function effectiveDeadline(sources: DeadlineSources): string | null {
  if (sources.individual !== undefined) return sources.individual.deadline;
  const dated = sources.groups.flatMap((g) =>
    g.deadline === null ? [] : [later(g.deadline, g.joinedDay)],
  );
  const [first, ...rest] = dated;
  return first === undefined ? null : rest.reduce(earlier, first);
}

/** What a player's badges on one assignment depend on. */
export interface AssignmentStatusFacts {
  /** The effective deadline, `YYYY-MM-DD`, or null. */
  readonly deadline: string | null;
  /** Every player move learned (R-129, chess allLearned). */
  readonly done: boolean;
  readonly paused: boolean;
  readonly forked: boolean;
}

export interface AssignmentStatus {
  readonly overdue: boolean;
  readonly paused: boolean;
  readonly done: boolean;
  readonly forked: boolean;
}

const FORKED: AssignmentStatus = {
  overdue: false,
  paused: false,
  done: false,
  forked: true,
};

/**
 * The badges a player and the coach see (R-51, R-128, R-129, R-132):
 * overdue from the Vilnius day after the deadline unless done, also when
 * paused; a forked assignment shows only "forked".
 */
export function assignmentStatus(
  facts: AssignmentStatusFacts,
  now: Date,
): AssignmentStatus {
  if (facts.forked) return FORKED;
  const passed = facts.deadline !== null && vilniusDay(now) > facts.deadline;
  return {
    overdue: passed && !facts.done,
    paused: facts.paused,
    done: facts.done,
    forked: false,
  };
}

/** A player's hold on one assigned repertoire, read fresh. */
export interface AssignmentHold {
  readonly assigned: boolean;
  readonly forked: boolean;
}

/**
 * A player opens, pauses or marks seen only a repertoire assigned to them
 * now and not forked (R-46, R-128); anything else reads as missing.
 */
export function canUseAssignment(hold: AssignmentHold): AssignmentResult {
  return hold.assigned && !hold.forked
    ? OK
    : refuse(ASSIGNMENT_REFUSALS.notFound);
}

/**
 * A player forks only a live assignment they have: assigned now and not
 * already forked (R-20, R-128).
 */
export function canFork(hold: AssignmentHold): AssignmentResult {
  return canUseAssignment(hold);
}

/** What a player's "Updated" flag on one assignment depends on. */
export interface SeenFacts {
  /** The version the player last opened; null if never. */
  readonly seenVersion: number | null;
  /** The repertoire's version when assigned (the lowest, across its rows). */
  readonly assignedVersion: number;
}

/**
 * The version after which a coach's change is news to the player: the one
 * they last saw, never before the one they were assigned (R-133).
 */
export const seenFloor = (facts: SeenFacts): number =>
  Math.max(facts.seenVersion ?? 0, facts.assignedVersion);

/**
 * "Updated" (R-133): the coach changed it, for players, after the floor.
 * `latestVersion` is the version of the latest such change, 0 for none.
 */
export const isUpdated = (facts: SeenFacts, latestVersion: number): boolean =>
  latestVersion > seenFloor(facts);

/** A paused assignment leaves training (R-46); anything else trains. */
export const isTrainingActive = (pausedAt: Date | null): boolean =>
  pausedAt === null;
