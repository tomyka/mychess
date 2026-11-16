/**
 * A player's deadlines as their coach's home shows them (#329): the
 * nearest deadline of this coach's live assignments the player has not
 * finished, and whether any of them is overdue. Built on the one status
 * rule (assignmentStatusOf: the effective deadline, R-16, R-134, and
 * overdue, R-51) and on isCoachLinked: nothing without an active link.
 */
import type { RepertoireGraph } from '@mychess/chess';
import {
  assignmentStatusOf,
  canUseAssignment,
  type AssignmentFacts,
} from './assignment';
import { isCoachLinked, type CoachProgressFacts } from './coach-progress';

/** What the home shows of one player's deadlines. */
export interface PlayerDeadlines {
  /** The earliest effective deadline, `YYYY-MM-DD`, of the assignments not done; null for none. */
  readonly nearestDeadline: string | null;
  /** Some live assignment is overdue (assignmentStatus). */
  readonly overdue: boolean;
}

/** What the status of each assignment is read from. */
interface DeadlineReads {
  /** The assigned repertoires' graphs as they are now, by id. */
  readonly graphs: ReadonlyMap<string, RepertoireGraph>;
  /** The player's tracked move keys (R-181). */
  readonly tracked: ReadonlySet<string>;
  readonly now: Date;
}

/** No deadline, nothing overdue. */
export const NO_DEADLINES: PlayerDeadlines = {
  nearestDeadline: null,
  overdue: false,
};

/**
 * The assignments playerDeadlines decides on: `coachId`'s live ones of
 * `playerId` (canUseAssignment: reaching them, not forked; paused ones
 * count), none without a link. A read loads the graphs of these only.
 */
export function deadlineAssignments(
  coachId: string,
  playerId: string,
  facts: CoachProgressFacts,
): AssignmentFacts[] {
  if (!isCoachLinked(coachId, playerId, facts)) return [];
  return facts.assignments.filter(
    (a) =>
      a.coachId === coachId &&
      a.playerId === playerId &&
      canUseAssignment(a).ok,
  );
}

/**
 * `playerId`'s deadlines on deadlineAssignments. An assignment whose graph
 * was not read is left out.
 */
export function playerDeadlines(
  coachId: string,
  playerId: string,
  facts: CoachProgressFacts,
  { graphs, tracked, now }: DeadlineReads,
): PlayerDeadlines {
  const statuses = deadlineAssignments(coachId, playerId, facts).flatMap(
    (a) => {
      const graph = graphs.get(a.repertoireId);
      return graph === undefined
        ? []
        : [assignmentStatusOf(a, { graph, tracked, now })];
    },
  );
  const open = statuses.filter((s) => !s.done && s.deadline !== null);
  return {
    nearestDeadline: open.map((s) => s.deadline).toSorted()[0] ?? null,
    overdue: statuses.some((s) => s.overdue),
  };
}
