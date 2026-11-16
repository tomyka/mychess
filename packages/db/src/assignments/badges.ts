/**
 * The S5 badges a coach sees on one player's assignment, from that player's
 * Reviews of the repertoire's moves. The one place a coach read composes the
 * badges (the domain's assignmentStatusOf decides done, R-129):
 * coachAssignments and the progress reads both call it. Internal to the
 * package.
 */
import type { RepertoireGraph, TrackedReview } from '@mychess/chess';
import {
  coachAssignmentBadges,
  type AssignmentFacts,
  type BadgeSet,
} from '@mychess/domain';

/**
 * An assignment's badges as the coach sees them at `now`; `tracked` holds
 * the player's Reviews by move key (R-181).
 */
export const coachBadges = (
  facts: AssignmentFacts,
  graph: RepertoireGraph,
  tracked: ReadonlyMap<string, TrackedReview>,
  now: Date,
): BadgeSet =>
  coachAssignmentBadges(facts, {
    graph,
    tracked: new Set(tracked.keys()),
    now,
  });
