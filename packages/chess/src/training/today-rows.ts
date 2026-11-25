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
import { dueByRepertoire, learnStart, type TrainingDay } from './training-day';

/** One repertoire as Today lists it. */
export interface TodayRow {
  readonly repertoireId: string;
  /** Its Reviews due now, as a review of it alone asks them; 0 when paused. */
  readonly due: number;
  /** Whether a learn session of it alone would start (R-146 allowance left). */
  readonly canLearn: boolean;
  /** Its moves' R-151 states and whether it is mastered. */
  readonly standing: Standing;
}

/** The day's Reviews with how each entered training (`known`: "I know this"). */
const trackedOf = (
  reviews: TrainingDay['reviews'],
  known: ReadonlySet<string>,
): Map<string, TrackedReview> =>
  new Map(
    [...reviews].map(([key, review]) => [
      key,
      { review, knownWithoutLearning: known.has(key) },
    ]),
  );

/**
 * Whether a learn session of `repertoire` alone, without the day's focus,
 * would start. A paused repertoire's learn plan is empty, so it never does.
 */
const canLearn = (day: TrainingDay, repertoire: TrainingRepertoire): boolean =>
  learnStart({
    repertoires: [repertoire],
    tracked: day.tracked,
    learnedToday: day.learnedToday,
    limits: day.limits,
  }).kind === 'drill';

/**
 * Today's rows at `now`. `known` holds the keys whose Review entered
 * training by "I know this" (R-58), so skipped moves count as skipped.
 */
export function todayRows(
  day: TrainingDay,
  known: ReadonlySet<string>,
  now: Date,
): TodayRow[] {
  const tracked = trackedOf(day.reviews, known);
  const due = dueByRepertoire(day, now);
  const rank = new Map(due.map((d, i) => [d.repertoireId, i]));
  const dueOf = new Map(due.map((d) => [d.repertoireId, d.due]));
  const rankOf = (id: string): number => rank.get(id) ?? due.length;
  // The sort is stable: rows of equal rank keep the learn order.
  return [...day.repertoires]
    .sort((a, b) => rankOf(a.id) - rankOf(b.id))
    .map((repertoire) => ({
      repertoireId: repertoire.id,
      due: dueOf.get(repertoire.id) ?? 0,
      canLearn: canLearn(day, repertoire),
      standing: repertoireStanding(repertoire.graph, tracked, now),
    }));
}
