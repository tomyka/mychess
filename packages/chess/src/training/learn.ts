/**
 * How a move enters review: the learn pass (R-55) or "I know this" (R-58).
 * Both start the move's Review here, so a caller cannot schedule a move that
 * was never learned or skip the next-day first review.
 */
import { startReview, type ReviewState } from './schedule';
import { scopeKeys, type Scope } from './scope';

export type LearnEvent = 'seen' | 'correct' | 'wrong';

/**
 * A move in its learn pass: its arrow `shown`, then `asked` blind. Once
 * `learned` it carries its new Review, the first one due the next day.
 */
export type LearnState =
  | { readonly key: string; readonly step: 'shown' | 'asked' }
  | {
      readonly key: string;
      readonly step: 'learned';
      readonly review: ReviewState;
    };

/** The pass starts with the arrow shown. */
export const startLearn = (key: string): LearnState => ({ key, step: 'shown' });

/**
 * Arrow shown, then a blind retest; one correct retest ends the pass and
 * starts the Review at `now`, a wrong one shows the arrow again (R-55).
 * Events that do not apply to the step change nothing.
 */
export function learnStep(
  state: LearnState,
  event: LearnEvent,
  now: Date,
): LearnState {
  const { key, step } = state;
  if (step === 'shown' && event === 'seen') return { key, step: 'asked' };
  if (step !== 'asked' || event === 'seen') return state;
  return event === 'correct'
    ? { key, step: 'learned', review: startReview(key, now) }
    : { key, step: 'shown' };
}

/**
 * "I know this" (R-58): the scope's moves skip the learn pass and start their
 * Reviews at `now`, in line order. A move already in review keeps its state,
 * so it is not among the Reviews returned. The Reviews look like learned
 * ones: the caller must record that they came from "I know this", since the
 * coach sees skipped moves (R-58).
 */
export function knowThis(
  scope: Scope,
  reviews: ReadonlyMap<string, unknown>,
  now: Date,
): ReviewState[] {
  return scopeKeys(scope)
    .filter((key) => !reviews.has(key))
    .map((key) => startReview(key, now));
}
