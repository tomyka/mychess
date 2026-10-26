// What a training snapshot holds to drill now: the due Reviews and the new
// moves today's allowance leaves. The rules are chess's (buildQueue,
// dueCount, learnPlan); these only run them over the snapshot's plain data,
// the same way on the server (home's counts) and in the browser (the drills).
import {
  buildQueue,
  dueCount,
  learnPlan,
  type LearnLine,
  type QueueItem,
  type ReviewState,
  type TrainingRepertoire,
} from '@mychess/chess';
import type { TrainingData } from './training-data';

/** The entries as training sees them. */
export const repertoiresOf = (data: TrainingData): TrainingRepertoire[] =>
  data.entries.map(({ id, graph, active }) => ({ id, graph, active }));

/** New moves still allowed today (R-62, R-146). */
export const allowance = (data: TrainingData): number =>
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

/** What a page shows before training starts (U1-M1-3). */
export interface TrainingCounts {
  /** Every Review due now, across the data's active repertoires. */
  readonly due: number;
  /** The new moves a learn session would teach now. */
  readonly toLearn: number;
}

/** The due and to-learn counts of `data`. */
export const trainingCounts = (data: TrainingData): TrainingCounts => ({
  due: dueCount(
    { repertoires: repertoiresOf(data), reviews: reviewsOf(data) },
    data.now,
  ),
  toLearn: toLearn(data),
});
