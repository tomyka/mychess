/**
 * The one state a player move is in (R-151), read from its Review and how
 * it entered training. Coach progress counts it (R-177) and mastery needs
 * it to be learned (R-178), so it sits below both.
 */
import { isDue, type ReviewState } from './schedule';
import { unreviewed } from './stored-review';

/** R-151: the one state the coach sees a move in. */
export type MoveState = 'notStarted' | 'skipped' | 'due' | 'learned';

/** A player's Review of a move, and how it entered training. */
export interface TrackedReview {
  readonly review: ReviewState;
  /**
   * Entered training by "I know this" rather than a learn pass. Not the
   * 'skipped' MoveState: that also needs the Review never graded since.
   */
  readonly knownWithoutLearning: boolean;
}

/**
 * R-151: due once the Review is due (a skipped move's first Review
 * included); skipped while "I know this" was never graded since; else
 * learned.
 */
export function moveState(
  tracked: TrackedReview | undefined,
  now: Date,
): MoveState {
  if (tracked === undefined) return 'notStarted';
  if (isDue(tracked.review, now)) return 'due';
  return tracked.knownWithoutLearning && unreviewed(tracked.review)
    ? 'skipped'
    : 'learned';
}
