/**
 * The S5 badges and the full status a coach sees on one player's
 * assignment, from that player's Reviews of the repertoire's moves. The one
 * place a coach read composes them (the domain's assignmentStatusOf decides
 * done, R-129): coachBadges and coachStatus are shared by coachAssignments
 * and the progress reads. Internal to the package.
 */
import type { RepertoireGraph, TrackedReview } from '@mychess/chess';
import {
  assignmentStatusOf,
  coachAssignmentBadges,
  type AssignmentFacts,
  type AssignmentProgress,
  type BadgeSet,
  type CoachRowStatus,
} from '@mychess/domain';

/** The coach's full status of one player's assignment: deadline and done too (R-129). */
export type CoachStatus = CoachRowStatus;

/** What the domain reads of the player's Reviews: the tracked move keys (R-181). */
const progressOf = (
  graph: RepertoireGraph,
  tracked: ReadonlyMap<string, TrackedReview>,
  now: Date,
): AssignmentProgress => ({ graph, tracked: new Set(tracked.keys()), now });

/**
 * An assignment's badges as the coach sees them at `now`; `tracked` holds
 * the player's Reviews by move key (R-181).
 */
export const coachBadges = (
  facts: AssignmentFacts,
  graph: RepertoireGraph,
  tracked: ReadonlyMap<string, TrackedReview>,
  now: Date,
): BadgeSet => coachAssignmentBadges(facts, progressOf(graph, tracked, now));

/** An assignment's status as the coach sees it at `now`, from the same Reviews. */
export const coachStatus = (
  facts: AssignmentFacts,
  graph: RepertoireGraph,
  tracked: ReadonlyMap<string, TrackedReview>,
  now: Date,
): CoachStatus => assignmentStatusOf(facts, progressOf(graph, tracked, now));
