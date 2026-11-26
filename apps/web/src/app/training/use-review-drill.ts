'use client';

import {
  answerReview,
  dueReviews,
  hintReview,
  nextDue,
  toLearnCount,
  type BoardMove,
  type ReviewBounds,
  type ReviewEmit,
  type TrainingDay,
} from '@mychess/chess';
import { dayEnd } from '@mychess/domain';
import { useEffect, useMemo, useState } from 'react';
import type { TrainingData } from '../../lib/training-data';
import type { DrillResult, Step } from './drill-core';
import { BROWSER_CLOCK, type DrillClock } from './drill-input';
import {
  advanced,
  released,
  afterAnswer,
  afterHint,
  answeredMove,
  canHint,
  frameOf,
  isDone,
  startReviewDrill,
  type ReviewDrillState,
} from './review-drill-state';
import { useDrill, type Drill, type DrillRules } from './use-drill';
import type { ResultSync } from './use-result-sync';

/** The longest wait `setTimeout` keeps (about 24.8 days). */
const MAX_TIMER_MS = 2 ** 31 - 1;

export interface ReviewDrill extends Drill<ReviewDrillState> {
  readonly hint: () => void;
}

/** A session at `now`: the player's size, up to the end of their day. */
const boundsOf = (
  day: Pick<TrainingDay, 'limits'>,
  now: Date,
): ReviewBounds => ({ size: day.limits.reviews, dayEnd: dayEnd(now) });

/**
 * A session over what `day` has due at `now`, up to the end of the day
 * `now` falls in: the clock's, not the snapshot's, so a page loaded
 * yesterday still repeats today's lapses (R-78).
 */
const drillAt = (day: TrainingDay, now: Date): ReviewDrillState =>
  startReviewDrill(
    dueReviews(day, now),
    day.repertoires,
    day.reviews,
    boundsOf(day, now),
  );

/** The emitted outcome, as a result to record (R-60). */
const resultOf = (emit: ReviewEmit | null): DrillResult | null =>
  emit === null
    ? null
    : {
        kind: emit.outcome,
        moveKey: emit.key,
        repertoireId: emit.repertoireId,
      };

/** The player's `move`, answered and graded in the local Reviews at `now`. */
function answered(
  s: ReviewDrillState,
  move: BoardMove,
  now: Date,
): Step<ReviewDrillState> {
  const answer = answerReview(s.session, move.san, {
    now,
    reviews: s.reviews,
  });
  return { state: afterAnswer(s, move, answer), result: resultOf(answer.emit) };
}

/** The hint at `now`: the piece shown, the hint graded (R-61). */
function hinted(s: ReviewDrillState, now: Date): Step<ReviewDrillState> {
  const hint = hintReview(s.session, { now, reviews: s.reviews });
  return { state: afterHint(s, hint), result: resultOf(hint.emit) };
}

/**
 * How the review drill goes: the Reviews due at the snapshot, each answer
 * graded in the browser; a right answer is held for its flash, or by its
 * notices until Next, then the next item is chosen at its time (a repeat
 * may be due, R-78); a Lapse's arrow waits for its move.
 */
const REVIEW_RULES: DrillRules<ReviewDrillState> = {
  start: ({ day, now }) => drillAt(day, now),
  frameOf,
  play: answered,
  noticed: (s) => ({ move: answeredMove(s), holds: true }),
  answeredRight: (s) => s.session.phase === 'correct',
  onward: (s, day, now) => released(s, day.repertoires, now),
  sliding: (s) => s.replying,
  slid: advanced,
  isDone,
  // Continue while the Reviews graded so far leave more due now (R-62,
  // R-78); new moves while the snapshot's day has some to learn.
  offer: ({ day, due }) => ({
    continue: due,
    review: false,
    learn: toLearnCount(day) > 0,
  }),
};

/**
 * The first Review of `day`'s active repertoires due after `now`, in ms
 * from now, if a timer can wait that long.
 */
function nextDueIn(day: TrainingDay, now: Date): number | null {
  const due = nextDue(day, now);
  const wait = due === null ? Infinity : due.getTime() - now.getTime();
  return wait <= MAX_TIMER_MS ? wait : null;
}

/**
 * Once done, renders again when the next graded Review comes due: a Lapse
 * is due within minutes (R-78), and "continue" then has something to offer.
 */
function useDueAgain(
  done: boolean,
  gradedDay: TrainingDay,
  clock: DrillClock,
): void {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const wait = done ? nextDueIn(gradedDay, clock.now()) : null;
    if (wait === null) return undefined;
    const timer = setTimeout(() => {
      setTick(tick + 1);
    }, wait);
    return () => {
      clearTimeout(timer);
    };
  }, [done, gradedDay, clock, tick]);
}

/**
 * The review drill (plan Task C5): the session over the Reviews due at the
 * snapshot, each answer recorded and graded in the browser, and the board's
 * view of it.
 */
export function useReviewDrill(
  data: TrainingData,
  sync: ResultSync,
  clock: DrillClock = BROWSER_CLOCK,
): ReviewDrill {
  const { drill, day, take } = useDrill(REVIEW_RULES, { data, sync, clock });
  const { state } = drill;
  const gradedDay = useMemo(
    () => ({ ...day, reviews: state.reviews }),
    [day, state.reviews],
  );
  useDueAgain(isDone(state), gradedDay, clock);
  return {
    ...drill,
    hint() {
      if (canHint(state)) take(hinted);
    },
  };
}
