// What the training page opens on (docs/design/training-screen.md, States):
// the drill, or one of its empty states. The rules of what is due and what
// may be learned are chess's (buildQueue, learnPlan); this only picks the
// screen from their answers.
import {
  buildQueue,
  learnPlan,
  playerKeys,
  type LearnLine,
  type QueueItem,
  type ReviewState,
  type TrainingRepertoire,
} from '@mychess/chess';
import type { TrainingData } from '../../server/training';

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

/** The entries as training sees them. */
export const repertoiresOf = (data: TrainingData): TrainingRepertoire[] =>
  data.entries.map(({ id, graph, active }) => ({ id, graph, active }));

/** New moves still allowed today (R-62, R-146). */
const allowance = (data: TrainingData): number =>
  Math.max(0, data.settings.newPerDay - data.learnedToday);

/** The player's Reviews by key, as the snapshot holds them. */
export const reviewsOf = (data: TrainingData): Map<string, ReviewState> =>
  new Map(data.reviews.map((r) => [r.key, r]));

/**
 * The Reviews due at `now`, up to the session size, the earliest due
 * first, from the snapshot's Reviews or a drill's graded copy of them.
 */
export function dueReviews(
  data: TrainingData,
  reviews: ReadonlyMap<string, ReviewState>,
  now: Date,
): readonly QueueItem[] {
  const queue = buildQueue(
    {
      repertoires: repertoiresOf(data),
      reviews,
      learnedToday: data.learnedToday,
    },
    now,
    { reviews: data.settings.sessionSize, newPerDay: data.settings.newPerDay },
  );
  // The settings were parsed with the domain's bounds: out of range here is
  // a programmer error, not a refusal to show.
  if (!queue.ok) throw new Error(`training settings: ${queue.refusal.limit}`);
  return queue.value.reviews;
}

/**
 * The lines a learn session teaches (R-144, R-145), in the entries' learn
 * order, up to what is left of today's allowance.
 */
export const learnLines = (data: TrainingData): LearnLine[] =>
  learnPlan(repertoiresOf(data), new Set(data.learned), allowance(data));

/** The new moves in `lines`. */
export const newKeys = (lines: readonly LearnLine[]): string[] =>
  lines.flatMap((line) =>
    line.steps.filter((step) => step.kind === 'new').map((step) => step.key),
  );

/** The new moves a learn session would teach now. */
export const toLearn = (data: TrainingData): number =>
  newKeys(learnLines(data)).length;

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
