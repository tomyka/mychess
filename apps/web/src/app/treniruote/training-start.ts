// What the training page opens on (docs/design/training-screen.md, States):
// the drill, or one of its empty states. The rules of what is due and what
// may be learned are chess's (buildQueue, learnPlan); this only picks the
// screen from their answers.
import { playerKeys } from '@mychess/chess';
import {
  allowance,
  dueReviews,
  reviewsOf,
  toLearn,
} from '../../lib/training-counts';
import type { TrainingData } from '../../lib/training-data';

export type StartState =
  /** Something to drill in the page's mode. */
  | { readonly kind: 'drill' }
  /** No repertoire holds a move of the player's side: nothing to train. */
  | { readonly kind: 'noMoves' }
  /** Review with nothing due; `toLearn` new moves today's allowance allows. */
  | { readonly kind: 'nothingDue'; readonly toLearn: number }
  /** Learn with moves left but none allowed today (R-146). */
  | { readonly kind: 'limitReached' }
  /** Learn with every move of the active repertoires learned. */
  | { readonly kind: 'nothingLeft' };

/** Does an active repertoire hold an own move not learned yet? */
function anyLeft(data: TrainingData): boolean {
  const learned = new Set(data.learned);
  return data.entries
    .filter((e) => e.active)
    .some((e) => playerKeys(e.graph).some((key) => !learned.has(key)));
}

function learnStart(data: TrainingData): StartState {
  if (!anyLeft(data)) return { kind: 'nothingLeft' };
  return allowance(data) === 0 ? { kind: 'limitReached' } : { kind: 'drill' };
}

/** What the page shows first for `data`. */
export function startState(data: TrainingData): StartState {
  if (data.entries.every((e) => playerKeys(e.graph).length === 0))
    return { kind: 'noMoves' };
  if (data.mode === 'learn') return learnStart(data);
  return dueReviews(data, reviewsOf(data), data.now).length > 0
    ? { kind: 'drill' }
    : { kind: 'nothingDue', toLearn: toLearn(data) };
}
