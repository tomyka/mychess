/**
 * The S5 badges a coach sees on one player's assignment, from that player's
 * Reviews of the repertoire's moves. The one place a coach read decides done
 * (R-129) and composes the badges: coachAssignments and the progress reads
 * both call it. Internal to the package.
 */
import {
  allLearned,
  type RepertoireGraph,
  type TrackedReview,
} from '@mychess/chess';
import {
  coachAssignmentBadges,
  type AssignmentFacts,
  type BadgeSet,
} from '@mychess/domain';

/**
 * An assignment's badges as the coach sees them at `now`; done when every
 * player move of `graph` is learned or skipped (a key of `tracked`).
 */
export const coachBadges = (
  facts: AssignmentFacts,
  graph: RepertoireGraph,
  tracked: ReadonlyMap<string, TrackedReview>,
  now: Date,
): BadgeSet =>
  coachAssignmentBadges(facts, {
    done: allLearned(graph, new Set(tracked.keys())),
    now,
  });
