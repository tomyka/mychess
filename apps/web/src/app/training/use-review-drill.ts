'use client';

import {
  answerReview,
  dayStanding,
  dueCount,
  dueReviews,
  hintReview,
  nextDue,
  toLearnCount,
  trainingProgress,
  type BoardMove,
  type ReviewBounds,
  type DayStanding,
  type ReviewEmit,
  type TrainingDay,
  type TrainingProgress,
  type TrainingRepertoire,
} from '@mychess/chess';
import {
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { TrainingData } from '../../lib/training-data';
import { MOVE_DURATION } from '../board/board-config';
import { useDrillBoard, type DrillBoard } from './drill-board';
import {
  BROWSER_CLOCK,
  FEEDBACK_MS,
  useMoveInput,
  useTimer,
  type DrillClock,
  type MoveInput,
} from './drill-input';
import {
  advanced,
  afterAnswer,
  answeredMove,
  afterHint,
  canHint,
  canPlay,
  canType,
  isDone,
  positionOf,
  repertoireOf,
  chapterOf,
  shownKey,
  startDrill,
  type DrillState,
} from './review-drill-state';
import {
  drillNotices,
  hasNotices,
  namedOf,
  type DrillNotices,
} from './drill-notices';
import { dayEnd } from '@mychess/domain';
import { dayOf } from '../../lib/training-day';
import type { ResultSync } from './use-result-sync';

/** The longest wait `setTimeout` keeps (about 24.8 days). */
const MAX_TIMER_MS = 2 ** 31 - 1;

/** What the player does on the board and in the panel. */
interface DrillInput extends MoveInput {
  readonly hint: () => void;
  /** A new session over what is due now (R-62's "continue"). */
  readonly restart: () => void;
}

export interface ReviewDrill
  extends
    DrillInput,
    DrillNotices,
    Pick<DrillBoard, 'view' | 'item' | 'toMove'> {
  readonly state: DrillState;
  /** Done, and the Reviews graded so far leave more due now (R-62, R-78). */
  readonly canContinue: boolean;
  /**
   * On to the next item, once the answer is right and Coach notes or the
   * two-answers notice hold it (R-174, decision 4); null otherwise, the
   * drill then going on by itself.
   */
  readonly next: (() => void) | null;
  /** The snapshot's day has new moves to learn (the done summary's link). */
  readonly learnable: boolean;
  /** Where the repertoires stand now, by the Reviews graded so far. */
  readonly progress: () => TrainingProgress;
  /** Where the player's day stands now (#319). */
  readonly standing: () => DayStanding;
}

type SetState = Dispatch<SetStateAction<DrillState>>;

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
const drillAt = (day: TrainingDay, now: Date): DrillState =>
  startDrill(
    dueReviews(day, now),
    day.repertoires,
    day.reviews,
    boundsOf(day, now),
  );

const putBack = (s: DrillState): DrillState => ({
  ...s,
  revision: s.revision + 1,
});

interface TimerContext {
  readonly state: DrillState;
  readonly setState: SetState;
  readonly repertoires: readonly TrainingRepertoire[];
  /** A Coach note or the two-answers notice waits to be read. */
  readonly held: boolean;
  /** The next item is chosen at its time: a repeat may be due (R-78). */
  readonly clock: DrillClock;
}

/**
 * Where the player's day stands once the session is `done`, by the
 * Reviews graded so far, read at the clock's time.
 */
function dayView(
  gradedDay: TrainingDay,
  clock: DrillClock,
  done: boolean,
): Pick<ReviewDrill, 'canContinue' | 'progress' | 'standing'> {
  return {
    canContinue: done && dueCount(gradedDay, clock.now()) > 0,
    progress: () => trainingProgress(gradedDay, clock.now()),
    standing: () => {
      const now = clock.now();
      return dayStanding(trainingProgress(gradedDay, now), dayEnd(now));
    },
  };
}

/**
 * The drill's timed steps: after the correct flash the next item, unless
 * a Coach note waits to be read (`held`), then the reply's slide with the
 * board locked. Returns the step to the next item, for the note's button.
 */
function useDrillTimers(t: TimerContext): () => void {
  const { state, setState, repertoires, held, clock } = t;
  const next = useMemo(
    () => () => {
      const now = clock.now();
      setState((s) => advanced(s, repertoires, now));
    },
    [setState, repertoires, clock],
  );
  useTimer(state.session.phase === 'correct' && !held, FEEDBACK_MS, next);
  const unlock = useMemo(
    () => () => {
      setState((s) => ({ ...s, replying: false }));
    },
    [setState],
  );
  useTimer(state.replying, MOVE_DURATION, unlock);
  return next;
}

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
  state: DrillState,
  gradedDay: TrainingDay,
  clock: DrillClock,
): void {
  const [tick, setTick] = useState(0);
  const done = isDone(state);
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

/** Queues the emitted result with the sync (R-60). */
function recorder(sync: ResultSync, clock: DrillClock) {
  return (emit: ReviewEmit | null, answeredAt: Date): void => {
    if (emit === null) return;
    sync.record({
      resultId: clock.newId(),
      kind: emit.outcome,
      moveKey: emit.key,
      repertoireId: emit.repertoireId,
      answeredAt,
    });
  };
}

interface InputContext {
  /** The training day with the Reviews graded so far. */
  readonly gradedDay: TrainingDay;
  readonly state: DrillState;
  readonly setState: SetState;
  readonly legal: readonly BoardMove[];
  readonly sync: ResultSync;
  readonly clock: DrillClock;
}

/** Each answer is recorded once it is made and graded in the local Reviews. */
function useDrillInput(c: InputContext): DrillInput {
  const { state, setState, clock } = c;
  const record = recorder(c.sync, clock);
  const input = useMoveInput({
    position: shownKey(state),
    legal: c.legal,
    canPlay: canPlay(state),
    canType: canType(state),
    play(move) {
      const now = clock.now();
      const answer = answerReview(state.session, move.san, {
        now,
        reviews: state.reviews,
      });
      record(answer.emit, now);
      setState(afterAnswer(state, move, answer));
    },
    putBack() {
      setState(putBack);
    },
    unknown() {
      setState({ ...state, unknownTyped: true });
    },
  });

  return {
    ...input,
    hint() {
      if (!canHint(state)) return;
      const now = clock.now();
      const hinted = hintReview(state.session, {
        now,
        reviews: state.reviews,
      });
      record(hinted.emit, now);
      setState(afterHint(state, hinted));
    },
    restart() {
      const started = drillAt(c.gradedDay, clock.now());
      // A new revision, so the board takes the new session's position.
      setState({ ...started, revision: state.revision + 1 });
    },
  };
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
  const day = useMemo(() => dayOf(data), [data]);
  const { repertoires } = day;
  const [state, setState] = useState(() => drillAt(day, clock.now()));
  const learnable = useMemo(() => toLearnCount(day) > 0, [day]);
  const gradedDay = useMemo(
    () => ({ ...day, reviews: state.reviews }),
    [day, state.reviews],
  );
  const named = useMemo(() => namedOf(data), [data]);
  const notices = drillNotices(
    data,
    named,
    repertoireOf(state),
    answeredMove(state),
  );
  const held = hasNotices(notices);
  const next = useDrillTimers({ state, setState, repertoires, held, clock });
  const { view, legal, item, toMove } = useDrillBoard({
    data,
    state,
    setState,
    positionOf,
    repertoireOf,
    chapterOf,
  });
  useDueAgain(state, gradedDay, clock);
  const input = useDrillInput({
    gradedDay,
    state,
    setState,
    legal,
    sync,
    clock,
  });
  return {
    ...input,
    ...dayView(gradedDay, clock, isDone(state)),
    state,
    view,
    item,
    toMove,
    learnable,
    ...notices,
    // Only a right answer held by what it shows waits for the button;
    // without it it goes on by itself, and a Lapse's arrow waits for its move.
    next: state.session.phase === 'correct' && held ? next : null,
  };
}
