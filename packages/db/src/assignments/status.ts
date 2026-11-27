/**
 * The full status a coach sees on one player's assignment, from that
 * player's Reviews of the repertoire's moves. The one place a coach read
 * composes it (the domain's assignmentStatusOf decides it, done included,
 * R-129): coachStatus is shared by coachAssignments and the progress reads.
 * Internal to the package.
 */
import type { RepertoireGraph, TrackedReview } from '@mychess/chess';
import {
  assignmentStatusOf,
  type AssignmentFacts,
  type CoachRowStatus,
} from '@mychess/domain';

/** The coach's full status of one player's assignment: deadline and done too (R-129). */
export type CoachStatus = CoachRowStatus;

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
