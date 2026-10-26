/**
 * A player's training day (R-62, R-146): what their training snapshot holds
 * to drill now. The daily allowance of new moves, the Reviews due among the
 * moves the active repertoires hold, when the next one comes due, where the
 * repertoires stand, and the screen training starts on. The server (home's
 * counts, the snapshot) and the browser (the drills, graded Reviews in hand)
 * read the same rules from here.
 */
import { learnPlan, type LearnLine } from './learn-plan';
import {
  buildQueue,
  heldMoves,
  newMovesLeft,
  walkedMoves,
  type QueueItem,
  type QueueLimits,
} from './queue';
import { isDue, type ReviewState } from './schedule';
import type { TrainingRepertoire } from './scope';

/** The training snapshot as plain data. */
export interface TrainingDay {
  /** The repertoires in scope, in learn order (R-145), paused ones included. */
  readonly repertoires: readonly TrainingRepertoire[];
  /**
   * The player's held Reviews by key, dormant ones left out (R-44); a drill
   * passes its copy graded during the session.
   */
  readonly reviews: ReadonlyMap<string, ReviewState>;
  /** Keys learned or skipped (R-129, R-147). */
  readonly learned: ReadonlySet<string>;
  /** Moves learned, not skipped, in the player's day so far (R-147). */
  readonly learnedToday: number;
  /** The player's session size and new moves a day, already parsed (R-146). */
  readonly limits: QueueLimits;
}

type Held = Pick<TrainingDay, 'repertoires' | 'reviews'>;

export type TrainingMode = 'review' | 'learn';

/** The screen training opens on (docs/design/training-screen.md, States). */
export type StartState =
  /** Something to drill in the mode. */
  | { readonly kind: 'drill' }
  /** No repertoire holds a move of the player's side: nothing to train. */
  | { readonly kind: 'noMoves' }
  /** Review with nothing due; `toLearn` new moves today's allowance allows. */
  | { readonly kind: 'nothingDue'; readonly toLearn: number }
  /** Learn with moves left but none allowed today (R-146). */
  | { readonly kind: 'limitReached' }
  /** Learn with every move of the active repertoires learned. */
  | { readonly kind: 'nothingLeft' };

/** What a page shows before training starts (U1-M1-3). */
export interface TrainingCounts {
  /** Every Review due now across the active repertoires, not cut at a session. */
  readonly due: number;
  /** The new moves a learn session would teach now. */
  readonly toLearn: number;
}

/** Where the active repertoires stand (the Done state's progress bar). */
export interface TrainingProgress {
  /** Held own moves with a Review, the due ones included. */
  readonly reviewed: number;
  /** Of those, the ones due now. */
  readonly due: number;
  /** Held own moves without a Review, whatever the allowance. */
  readonly toLearn: number;
  /** The earliest Review due after now, or null when none is. */
  readonly nextDue: Date | null;
}

/** New moves still allowed today (R-62, R-146). */
export const allowance = (
  day: Pick<TrainingDay, 'limits' | 'learnedToday'>,
): number => newMovesLeft(day.limits, day.learnedToday);

/** The keys of the moves training holds (`heldMoves`). */
const heldMoveKeys = (repertoires: TrainingDay['repertoires']): string[] =>
  heldMoves(repertoires).map((m) => m.key);

/** The Reviews of the moves training holds. */
function heldReviews(day: Held): ReviewState[] {
  return heldMoveKeys(day.repertoires).flatMap((key) => {
    const review = day.reviews.get(key);
    return review === undefined ? [] : [review];
  });
}

/**
 * How many Reviews are due at `now` across the active repertoires, each key
 * once and not cut at a session size: the moves `dueReviews` offers before
 * its cap.
 */
export const dueCount = (day: Held, now: Date): number =>
  heldReviews(day).filter((r) => isDue(r, now)).length;

/** The earliest Review of the active repertoires due after `now`, or null. */
export function nextDue(day: Held, now: Date): Date | null {
  const later = heldReviews(day)
    .filter((r) => !isDue(r, now))
    .map((r) => r.fsrs.due.getTime());
  return later.length === 0 ? null : new Date(Math.min(...later));
}

/** The progress over the own moves the active repertoires hold. */
export function trainingProgress(day: Held, now: Date): TrainingProgress {
  const reviewed = heldReviews(day).length;
  return {
    reviewed,
    due: dueCount(day, now),
    toLearn: heldMoveKeys(day.repertoires).length - reviewed,
    nextDue: nextDue(day, now),
  };
}

/**
 * The Reviews a session asks at `now`: due ones up to the session size, the
 * earliest due first. The limits were parsed with the player's settings, so
 * limits out of range are a programmer error, not a refusal.
 */
export function dueReviews(
  day: Omit<TrainingDay, 'learned'>,
  now: Date,
): readonly QueueItem[] {
  const queue = buildQueue(day, now, day.limits);
  if (!queue.ok) throw new Error(`training limits: ${queue.refusal.limit}`);
  return queue.value.reviews;
}

/**
 * The lines a learn session teaches (R-144, R-145), in the repertoires'
 * learn order, up to what is left of today's allowance.
 */
export const learnLines = (day: Omit<TrainingDay, 'reviews'>): LearnLine[] =>
  learnPlan(day.repertoires, day.learned, allowance(day));

/** The new moves in `lines`. */
export const newKeys = (lines: readonly LearnLine[]): string[] =>
  lines.flatMap((line) =>
    line.steps.filter((step) => step.kind === 'new').map((step) => step.key),
  );

/** The new moves a learn session would teach now: none once the allowance is used. */
export const toLearnCount = (day: Omit<TrainingDay, 'reviews'>): number =>
  newKeys(learnLines(day)).length;

/** The due and to-learn counts of `day` at `now`. */
export const trainingCounts = (
  day: TrainingDay,
  now: Date,
): TrainingCounts => ({
  due: dueCount(day, now),
  toLearn: toLearnCount(day),
});

function learnStart(day: TrainingDay): StartState {
  const left = heldMoveKeys(day.repertoires).some(
    (key) => !day.learned.has(key),
  );
  if (!left) return { kind: 'nothingLeft' };
  return allowance(day) === 0 ? { kind: 'limitReached' } : { kind: 'drill' };
}

/**
 * What training opens on for `mode` at `now`. A paused repertoire still
 * holds its moves, so it is not "no moves", but it offers nothing to drill.
 */
export function startState(
  day: TrainingDay,
  mode: TrainingMode,
  now: Date,
): StartState {
  if (walkedMoves(day.repertoires).length === 0) return { kind: 'noMoves' };
  if (mode === 'learn') return learnStart(day);
  return dueCount(day, now) > 0
    ? { kind: 'drill' }
    : { kind: 'nothingDue', toLearn: toLearnCount(day) };
}
