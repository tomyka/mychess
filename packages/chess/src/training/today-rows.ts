/**
 * Today's list of repertoires (R-221): each repertoire the player trains,
 * the ones with due moves first (R-207's order), then the rest in learn
 * order (R-145), each with its due count, whether a learn session of it
 * alone would start, and its R-151 standing for the learned percentage
 * (R-177) and Mastered (R-178).
 */
import { repertoireStanding, type Standing } from './coach-progress';
import type { TrackedReview } from './move-state';
import type { TrainingRepertoire } from './scope';
import {
  dueByRepertoire,
  repertoireLearn,
  type TrainingDay,
} from './training-day';

/** What a row's button starts: due moves before new ones, or nothing. */
export type TodayAction = 'review' | 'learn' | null;

/** One repertoire as Today lists it. */
export interface TodayRow {
  readonly repertoireId: string;
  /** Its Reviews due now, as a review of it alone asks them; 0 when paused. */
  readonly due: number;
  /** Whether a learn session of it alone would start (`repertoireLearn`). */
  readonly canLearn: boolean;
  /** Review when moves are due, else learn when it can, else nothing. */
  readonly action: TodayAction;
  /** Its moves' R-151 states and whether it is mastered. */
  readonly standing: Standing;
}

/** The day's Reviews with how each entered training ("I know this" or not). */
export const trackedReviews = (
  day: Pick<TrainingDay, 'reviews' | 'knownWithoutLearning'>,
): Map<string, TrackedReview> =>
  new Map(
    [...day.reviews].map(([key, review]) => [
      key,
      { review, knownWithoutLearning: day.knownWithoutLearning.has(key) },
    ]),
  );

const actionOf = (due: number, learn: boolean): TodayAction => {
  if (due > 0) return 'review';
  return learn ? 'learn' : null;
};

/** A row of `repertoire` with `due` Reviews due now. */
function rowOf(
  day: TrainingDay,
  repertoire: TrainingRepertoire,
  due: number,
  standing: Standing,
): TodayRow {
  // Honours a focus naming this repertoire; Today's day has none.
  const learn = repertoireLearn(day, repertoire.id).kind === 'drill';
  return {
    repertoireId: repertoire.id,
    due,
    canLearn: learn,
    action: actionOf(due, learn),
    standing,
  };
}

/** Today's rows at `now`. */
export function todayRows(day: TrainingDay, now: Date): TodayRow[] {
  const tracked = trackedReviews(day);
  const due = dueByRepertoire(day, now);
  const rank = new Map(due.map((d, i) => [d.repertoireId, i]));
  const dueOf = new Map(due.map((d) => [d.repertoireId, d.due]));
  const rankOf = (id: string): number => rank.get(id) ?? due.length;
  // The sort is stable: rows of equal rank keep the learn order.
  return [...day.repertoires]
    .sort((a, b) => rankOf(a.id) - rankOf(b.id))
    .map((repertoire) =>
      rowOf(
        day,
        repertoire,
        dueOf.get(repertoire.id) ?? 0,
        repertoireStanding(repertoire.graph, tracked, now),
      ),
    );
}
