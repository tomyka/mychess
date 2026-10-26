import { ok, refuse, type Result } from '@mychess/chess';
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
    : ok();
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
  return facts.found ? ok() : refuse(ASSIGNMENT_REFUSALS.notFound);
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
    new Set(assigned.filter((a) => a.kind === kind).map((a) => a.id));
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

/**
 * A deadline: a calendar date, `YYYY-MM-DD` (plan decision 10), in the
 * years 2000-9999, so that Postgres's `date` always stores it.
 */
export const deadlineSchema = z.iso
  .date({ error: ASSIGNMENT_ISSUES.deadlineInvalid, abort: true })
  .refine((date) => date >= '2000-01-01', {
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
  return dated.toSorted()[0] ?? null;
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
 * The assignment status assignmentBadges turns into badges (R-51, R-128, R-129, R-132):
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

/** Every badge an assignment can show (R-46, R-51, R-128, R-133). */
export interface BadgeSet {
  readonly overdue: boolean;
  readonly paused: boolean;
  readonly forked: boolean;
  readonly updated: boolean;
}

/**
 * What one audience's badges come from: the player's "From my coach", the
 * player's page of the assignment they have opened, or the coach's list of
 * the players an assignment reaches.
 */
export type BadgeFacts =
  | {
      readonly audience: 'player';
      readonly overdue: boolean;
      readonly paused: boolean;
      /** isUpdated: a coach change the player has not opened (R-133). */
      readonly updated: boolean;
    }
  | {
      readonly audience: 'player';
      /**
       * The player is on the assignment's page: opening it is what clears
       * "Updated", and the page shows what changed instead (R-133).
       */
      readonly opened: true;
      readonly overdue: boolean;
      readonly paused: boolean;
    }
  | {
      readonly audience: 'coach';
      readonly overdue: boolean;
      readonly paused: boolean;
      readonly forked: boolean;
    };

/**
 * The full badge set an audience sees (S5 spec). The player sees overdue,
 * paused and "Updated", the last not once they have opened it; never
 * forked, as a forked repertoire leaves their list (R-128). The coach sees
 * overdue, paused and forked; "Updated" is the player's own (R-133).
 */
export function assignmentBadges(facts: BadgeFacts): BadgeSet {
  const { overdue, paused } = facts;
  if (facts.audience === 'coach')
    return { overdue, paused, forked: facts.forked, updated: false };
  const updated = 'opened' in facts ? false : facts.updated;
  return { overdue, paused, forked: false, updated };
}

/**
 * One row through which a player has a repertoire, as "Updated" sees it:
 * the player has it from the later of the two.
 */
export interface AssignmentStart {
  /** The repertoire's version when this row assigned it. */
  readonly assignedVersion: number;
  /** When the player joined the group; null for an individual row. */
  readonly joinedAt: Date | null;
}

/** What a player's "Updated" flag on one assignment depends on. */
export interface SeenFacts {
  /** The version the player last opened; null if never. */
  readonly seenVersion: number | null;
  /** Every row through which the player has the repertoire. */
  readonly starts: readonly AssignmentStart[];
}

/** A coach's change for players: its version and when it was made. */
export interface ChangeStamp {
  readonly version: number;
  readonly createdAt: Date;
}

/**
 * The change came after the player had the repertoire through `start`:
 * after its assigned version and, through a group, after they joined
 * (R-136).
 */
const isAfterStart = (change: ChangeStamp, start: AssignmentStart): boolean =>
  change.version > start.assignedVersion &&
  (start.joinedAt === null || change.createdAt > start.joinedAt);

/**
 * A change is news to the player (R-133) when it is after the version they
 * last saw and after they had the repertoire through some row (R-136).
 */
const isNews = (facts: SeenFacts, change: ChangeStamp): boolean =>
  change.version > (facts.seenVersion ?? 0) &&
  facts.starts.some((start) => isAfterStart(change, start));

/** The changes that are news to the player (R-133, R-136), in order. */
export const newsOf = <T extends ChangeStamp>(
  facts: SeenFacts,
  changes: readonly T[],
): T[] => changes.filter((change) => isNews(facts, change));

/**
 * "Updated" (R-133): the coach's latest change for players is news. A
 * repertoire's versions and their times rise together, so when the latest
 * is not news, no earlier one is.
 */
export const isUpdated = (
  facts: SeenFacts,
  latest: ChangeStamp | undefined,
): boolean => latest !== undefined && isNews(facts, latest);

/** A paused assignment leaves training (R-46); anything else trains. */
export const isTrainingActive = (pausedAt: Date | null): boolean =>
  pausedAt === null;

/**
 * One assignment row through which a player has a repertoire. `joinedAt`
 * (from AssignmentStart) is null for the player's own row and the join time
 * for a group row.
 */
export interface AssignmentReach extends AssignmentStart {
  readonly assignmentId: string;
  /** The row's own deadline, `YYYY-MM-DD`, or null. */
  readonly deadline: string | null;
}

/** What is known of one player's assignment of one repertoire (R-16, R-46, R-128). */
export interface AssignmentFacts {
  readonly playerId: string;
  readonly repertoireId: string;
  /** The repertoire's owner; every reaching row is theirs (assignments_repertoire_fk). */
  readonly coachId: string;
  readonly reaches: readonly AssignmentReach[];
  readonly pausedAt: Date | null;
  readonly seenVersion: number | null;
  readonly forkedAt: Date | null;
}

/**
 * A player opens, pauses or marks seen only a repertoire assigned to them
 * now (some row reaches them) and not forked (R-46, R-128); anything else,
 * no record included, reads as missing.
 */
export function canUseAssignment(
  facts: AssignmentFacts | undefined,
): AssignmentResult {
  return facts !== undefined &&
    facts.reaches.length > 0 &&
    facts.forkedAt === null
    ? ok()
    : refuse(ASSIGNMENT_REFUSALS.notFound);
}

/**
 * A player forks only a live assignment they have: assigned now and not
 * already forked (R-20, R-128).
 */
export function canFork(facts: AssignmentFacts | undefined): AssignmentResult {
  return canUseAssignment(facts);
}

/**
 * The deadline sources of the rows through which a player has a
 * repertoire (R-16, R-134): the player's own row is the individual source,
 * each group row a group source on the member's Vilnius join day.
 */
export function deadlineSources(
  reaches: readonly AssignmentReach[],
): DeadlineSources {
  const groups: GroupDeadline[] = reaches.flatMap((reach) =>
    reach.joinedAt === null
      ? []
      : [{ deadline: reach.deadline, joinedDay: vilniusDay(reach.joinedAt) }],
  );
  const individual = reaches.find((reach) => reach.joinedAt === null);
  return individual === undefined
    ? { groups }
    : { individual: { deadline: individual.deadline }, groups };
}

/**
 * The one status rule for the player's and the coach's reads: the
 * effective deadline (R-16, R-134) and the badges on it (R-128, R-129,
 * R-132). `done` is the caller's (every player move learned).
 */
export function assignmentStatusOf(
  facts: AssignmentFacts,
  { done, now }: { readonly done: boolean; readonly now: Date },
): AssignmentStatus & { readonly deadline: string | null } {
  const deadline = effectiveDeadline(deadlineSources(facts.reaches));
  return {
    deadline,
    ...assignmentStatus(
      {
        deadline,
        done,
        paused: !isTrainingActive(facts.pausedAt),
        forked: facts.forkedAt !== null,
      },
      now,
    ),
  };
}

/**
 * The badges the coach sees on one player's assignment (R-46, R-128,
 * R-132): its status (assignmentStatusOf) as assignmentBadges shows it to
 * the coach. `done` is the caller's (every player move learned).
 */
export function coachAssignmentBadges(
  facts: AssignmentFacts,
  progress: { readonly done: boolean; readonly now: Date },
): BadgeSet {
  const { overdue, paused, forked } = assignmentStatusOf(facts, progress);
  return assignmentBadges({ audience: 'coach', overdue, paused, forked });
}
