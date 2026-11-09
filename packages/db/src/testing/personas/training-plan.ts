/**
 * A persona's training history as the browser would have queued it: which
 * moves were learned on which day, and every due review graded, with the
 * scheduler the app grades with (@mychess/chess). Pure: the seed records
 * the planned results through the app's own recordResults, which grades
 * them again and must agree.
 */
import { grade, startReview, type ReviewState } from '@mychess/chess';
import type { ResultKind } from '@mychess/domain';

const DAY_MS = 86_400_000;
/**
 * The hour (UTC) a persona trains: early morning in Vilnius, so what falls
 * due on the seed date is already due when testers sign in that day.
 */
const TRAINING_HOUR_MS = 5 * 3_600_000;

/** Moves learned through one repertoire on one day. */
interface LearnStep {
  readonly daysAgo: number;
  /** The repertoire's handle in the persona definitions. */
  readonly repertoire: string;
  readonly keys: readonly string[];
}

export interface TrainingScript {
  /** The days before the seed date the player does the due reviews. */
  readonly trainedDaysAgo: readonly number[];
  readonly learn: readonly LearnStep[];
  /** Lapses per move key, given on its first due reviews. */
  readonly lapses: ReadonlyMap<string, number>;
  /** The most reviews a day: one session (R-62); the rest stay due. */
  readonly reviewsPerDay: number;
}

interface PlannedResult {
  readonly kind: ResultKind;
  readonly moveKey: string;
  readonly repertoire: string;
}

export interface PlannedDay {
  readonly at: Date;
  readonly results: readonly PlannedResult[];
}

/** 05:00 UTC of the day `daysAgo` (a whole number, at least 1) before now's date. */
export function trainingInstant(now: Date, daysAgo: number): Date {
  if (!Number.isInteger(daysAgo) || daysAgo < 1)
    throw new Error(
      `training days ago must be a whole number from 1: ${String(daysAgo)}`,
    );
  const today = Math.floor(now.getTime() / DAY_MS) * DAY_MS;
  return new Date(today - daysAgo * DAY_MS + TRAINING_HOUR_MS);
}

/** A learned move as the plan tracks it. */
interface Tracked {
  review: ReviewState;
  readonly repertoire: string;
}

interface Planner {
  readonly tracked: Map<string, Tracked>;
  readonly lapsesLeft: Map<string, number>;
  readonly reviewsPerDay: number;
}

const dueTime = (entry: Tracked): number => entry.review.fsrs.due.getTime();

/** Up to reviewsPerDay of the reviews due at `at`, longest overdue first, graded. */
function reviewDue(planner: Planner, at: Date): PlannedResult[] {
  const due = [...planner.tracked.values()]
    .filter((entry) => dueTime(entry) <= at.getTime())
    .sort((a, b) => dueTime(a) - dueTime(b))
    .slice(0, planner.reviewsPerDay);
  return due.map((entry) => {
    const moveKey = entry.review.key;
    const left = planner.lapsesLeft.get(moveKey) ?? 0;
    const kind = left > 0 ? 'lapse' : 'pass';
    planner.lapsesLeft.set(moveKey, Math.max(0, left - 1));
    entry.review = grade(entry.review, kind, at);
    return { kind, moveKey, repertoire: entry.repertoire };
  });
}

function learnNew(
  planner: Planner,
  steps: readonly LearnStep[],
  at: Date,
): PlannedResult[] {
  const results: PlannedResult[] = [];
  for (const { repertoire, keys } of steps) {
    for (const moveKey of keys) {
      if (planner.tracked.has(moveKey)) continue;
      planner.tracked.set(moveKey, {
        review: startReview(moveKey, at),
        repertoire,
      });
      results.push({ kind: 'learned', moveKey, repertoire });
    }
  }
  return results;
}

/**
 * Each day the player trains, oldest first, with what they answered: the
 * reviews due that day, up to reviewsPerDay (a lapse while the key has
 * lapses left, otherwise a pass), then the moves learned that day. Days
 * with nothing to answer are left out.
 */
export function planTraining(script: TrainingScript, now: Date): PlannedDay[] {
  const planner: Planner = {
    tracked: new Map(),
    lapsesLeft: new Map(script.lapses),
    reviewsPerDay: script.reviewsPerDay,
  };
  const daysAgo = [
    ...new Set([
      ...script.trainedDaysAgo,
      ...script.learn.map((s) => s.daysAgo),
    ]),
  ].sort((a, b) => b - a);
  return daysAgo.flatMap((day) => {
    const at = trainingInstant(now, day);
    const steps = script.learn.filter((s) => s.daysAgo === day);
    const results = [
      ...reviewDue(planner, at),
      ...learnNew(planner, steps, at),
    ];
    return results.length === 0 ? [] : [{ at, results }];
  });
}

/**
 * `days` in order, cut into batches that each span less than seven days,
 * so a batch recorded at its last day keeps every answer's own time
 * (recordResults clamps answers older than seven days).
 */
export function weekBatches(days: readonly PlannedDay[]): PlannedDay[][] {
  const batches: PlannedDay[][] = [];
  for (const day of days) {
    const current = batches.at(-1);
    const first = current?.[0];
    if (
      current !== undefined &&
      first !== undefined &&
      day.at.getTime() - first.at.getTime() < 7 * DAY_MS
    ) {
      current.push(day);
    } else {
      batches.push([day]);
    }
  }
  return batches;
}
