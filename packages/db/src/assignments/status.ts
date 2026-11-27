/**
 * The full status a coach sees on one player's assignment, from that
 * player's Reviews of the repertoire's moves. The domain's
 * assignmentStatusOf decides it, done included (R-129); coachStatus
 * composes it for coachAssignments, and the progress reads take it from
 * the Coach view (coachViewOf). Internal to the package.
 */
import type { RepertoireGraph, TrackedReview } from '@mychess/chess';
import {
  assignmentStatusOf,
  type AssignmentFacts,
  type CoachView,
} from '@mychess/domain';

/** The coach's full status of one player's assignment: deadline and done too (R-129). */
export type CoachStatus = NonNullable<CoachView['status']>;

/**
 * An assignment's status as the coach sees it at `now`; `tracked` holds
 * the player's Reviews by move key (R-181).
 */
export const coachStatus = (
  facts: AssignmentFacts,
  graph: RepertoireGraph,
  tracked: ReadonlyMap<string, TrackedReview>,
  now: Date,
): CoachStatus =>
  assignmentStatusOf(facts, { graph, tracked: new Set(tracked.keys()), now });
