/**
 * A player's training day (R-62, R-146): what their training snapshot holds
 * to drill now. The daily allowance of new moves, the Reviews due among the
 * moves the active repertoires hold, when the next one comes due, where the
 * repertoires stand, and the screen training starts on. The server (home's
 * counts, the snapshot) and the browser (the drills, graded Reviews in hand)
 * read the same rules from here.
 */
import { learnPlan, type LearnFocus, type LearnLine } from './learn-plan';
import {
  buildQueue,
  heldMoves,
  newMovesLeft,
  walkedMoves,
  type QueueItem,
  type QueueLimits,
} from './queue';
import { isDue, startReview, type ReviewState } from './schedule';
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
  /** Tracked keys: a Review exists, learn pass finished or skipped (R-181). */
  readonly tracked: ReadonlySet<string>;
  /**
   * The tracked keys whose Review entered by "I know this" (R-58) rather
   * than a learn pass: a subset of `tracked`. R-151 counts such a move as
   * skipped until its Review is first graded.
   */
  readonly known: ReadonlySet<string>;
  /** Moves learned, not skipped, in the player's day so far (R-147). */
  readonly learnedToday: number;
  /** The player's session size and new moves a day, already parsed (R-146). */
  readonly limits: QueueLimits;
  /** One chapter or line to learn instead of the learn order (R-206). */
  readonly focus?: LearnFocus;
}

type Held = Pick<TrainingDay, 'repertoires' | 'reviews'>;

/**
 * What learning reads of a day: the tracked keys, never how a key entered
 * (`known`) nor the Reviews.
 */
export type LearnDay = Omit<TrainingDay, 'reviews' | 'known'>;

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

/** Where learning stands: the learn mode's start states. */
export type LearnStart = Extract<
  StartState,
  { readonly kind: 'drill' | 'limitReached' | 'nothingLeft' }
>;

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

/** Where the player's day stands once a session is over (#319). */
export type DayStanding =
  /** Moves due now that the session left: the session can go on (R-62). */
  | { readonly kind: 'due'; readonly count: number }
  /** Nothing due now, but a move comes back before the day ends (R-78). */
  | { readonly kind: 'laterToday'; readonly next: Date }
  /** Nothing comes back today; `next` is the first review after it, if any. */
  | { readonly kind: 'dayDone'; readonly next: Date | null };

/**
 * Where the day stands, by the repertoires' `progress` and the end of the
 * player's day: moves still due now are a "continue", a move coming back
 * before `dayEnd` is named with its time, and otherwise today's review is
 * done.
 */
export function dayStanding(
  progress: Pick<TrainingProgress, 'due' | 'nextDue'>,
  dayEnd: Date,
): DayStanding {
  const { due, nextDue } = progress;
  if (due > 0) return { kind: 'due', count: due };
  if (nextDue !== null && nextDue.getTime() < dayEnd.getTime())
    return { kind: 'laterToday', next: nextDue };
  return { kind: 'dayDone', next: nextDue };
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

/** One repertoire's Reviews due now, as home lists them (R-207). */
export interface RepertoireDue {
  readonly repertoireId: string;
  /** What a review of it alone asks before its session cap: shared moves count in each. */
  readonly due: number;
}

/**
 * `day` narrowed to one repertoire: what training that repertoire alone
 * (its page, its row on Today) reads. The Reviews, tracked and known keys,
 * allowance and limits stay the day's, so moves shared with other
 * repertoires and moves learned today count as they do for the whole day.
 * The focus stays only when it names this repertoire. An id the day does
 * not hold narrows to no repertoire: nothing due, nothing left to learn.
 */
export function repertoireDay(
  day: TrainingDay,
  repertoireId: string,
): TrainingDay {
  const { focus, ...rest } = day;
  const repertoires = day.repertoires.filter((r) => r.id === repertoireId);
  return focus?.repertoireId === repertoireId
    ? { ...rest, repertoires, focus }
    : { ...rest, repertoires };
}

/** The Reviews of one repertoire due at `now`, as a review of it alone counts them. */
const dueIn = (
  day: TrainingDay,
  repertoireId: string,
  now: Date,
): ReviewState[] =>
  heldReviews(repertoireDay(day, repertoireId)).filter((r) => isDue(r, now));

/**
 * The active repertoires with Reviews due at `now`, each counted as a
 * review of it alone counts them (R-142, R-207), the most urgent first: by
 * its earliest due Review, as the session orders them, then learn order.
 */
export function dueByRepertoire(day: TrainingDay, now: Date): RepertoireDue[] {
  return day.repertoires
    .map((repertoire, order) => {
      const due = dueIn(day, repertoire.id, now);
      const first = Math.min(...due.map((r) => r.fsrs.due.getTime()));
      return { repertoireId: repertoire.id, due: due.length, first, order };
    })
    .filter((r) => r.due > 0)
    .sort((a, b) => a.first - b.first || a.order - b.order)
    .map(({ repertoireId, due }) => ({ repertoireId, due }));
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
  day: Omit<TrainingDay, 'tracked' | 'known'>,
  now: Date,
): readonly QueueItem[] {
  const queue = buildQueue(day, now, day.limits);
  if (!queue.ok) throw new Error(`training limits: ${queue.refusal.limit}`);
  return queue.value.reviews;
}

/**
 * The lines a learn session teaches (R-144, R-145), in the repertoires'
 * learn order or only the day's focus (R-206), up to what is left of
 * today's allowance.
 */
export const learnLines = (day: LearnDay): LearnLine[] =>
  learnPlan(day.repertoires, day.tracked, allowance(day), day.focus);

/** A move learned in the browser whose result the snapshot may not hold yet. */
export interface LearnedMove {
  readonly key: string;
  /** When it was learned: its Review starts then. */
  readonly at: Date;
}

/** `learned` without the keys `tracked` holds, each key once, first kept. */
function untracked(
  learned: readonly LearnedMove[],
  tracked: ReadonlySet<string>,
): LearnedMove[] {
  const byKey = new Map<string, LearnedMove>();
  for (const move of learned) {
    if (!tracked.has(move.key) && !byKey.has(move.key))
      byKey.set(move.key, move);
  }
  return [...byKey.values()];
}

/**
 * `day` caught up with moves learned since its snapshot was read (decision
 * 2): each is tracked, and it counts toward today's allowance when learned
 * at or after `dayStart` (R-146), so an `at` in the future counts too. Its
 * Review is seeded as `startReview(key, at)` only, so the plan and counts
 * see it: callers must not read it as the move's real FSRS state, which is
 * the server's once the result is posted. A move the snapshot already
 * tracks changes nothing; with none left, `day` itself is returned.
 */
export function withLearned(
  day: TrainingDay,
  learned: readonly LearnedMove[],
  dayStart: Date,
): TrainingDay {
  const fresh = untracked(learned, day.tracked);
  if (fresh.length === 0) return day;
  const reviews = new Map(day.reviews);
  for (const { key, at } of fresh) reviews.set(key, startReview(key, at));
  const today = fresh.filter((m) => m.at.getTime() >= dayStart.getTime());
  return {
    ...day,
    reviews,
    tracked: new Set([...day.tracked, ...fresh.map((m) => m.key)]),
    learnedToday: day.learnedToday + today.length,
  };
}

/** The new moves in `lines`. */
export const newKeys = (lines: readonly LearnLine[]): string[] =>
  lines.flatMap((line) =>
    line.steps.filter((step) => step.kind === 'new').map((step) => step.key),
  );

/** The new moves a learn session would teach now: none once the allowance is used. */
export const toLearnCount = (day: LearnDay): number =>
  newKeys(learnLines(day)).length;

/** The due and to-learn counts of `day` at `now`. */
export const trainingCounts = (
  day: TrainingDay,
  now: Date,
): TrainingCounts => ({
  due: dueCount(day, now),
  toLearn: toLearnCount(day),
});

/**
 * Are any moves left to learn, in the focus or the active repertoires? The
 * learn plan without a limit decides, so "nothing left" is what a learn
 * session would find.
 */
const movesLeft = (day: LearnDay): boolean =>
  learnPlan(day.repertoires, day.tracked, Number.POSITIVE_INFINITY, day.focus)
    .length > 0;

/**
 * Where learning stands (decision 11): moves left and allowed, moves left
 * but today's allowance used, or nothing left; in the focus only, when the
 * day has one (R-206).
 */
export function learnStart(day: LearnDay): LearnStart {
  if (!movesLeft(day)) return { kind: 'nothingLeft' };
  return allowance(day) === 0 ? { kind: 'limitReached' } : { kind: 'drill' };
}

/**
 * Where learning one repertoire stands today (`learnStart` of
 * `repertoireDay`): moves left and allowed, the allowance used, or nothing
 * left. A paused repertoire, or one the day does not hold, has nothing left.
 */
export const repertoireLearn = (
  day: TrainingDay,
  repertoireId: string,
): LearnStart => learnStart(repertoireDay(day, repertoireId));

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
