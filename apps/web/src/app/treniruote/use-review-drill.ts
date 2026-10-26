'use client';

import {
  answerReview,
  dueCount,
  dueReviews,
  hintReview,
  legalMoves,
  nextDue,
  trainingProgress,
  type BoardMove,
  type ReviewEmit,
  type Side,
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
import { MOVE_DURATION, type BoardView } from '../board/board-config';
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
  afterHint,
  canHint,
  canPlay,
  drillBoard,
  isDone,
  shownKey,
  startDrill,
  type DrillState,
} from './review-drill-state';
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

export interface ReviewDrill extends DrillInput {
  readonly state: DrillState;
  readonly view: BoardView;
  /** Done, and the Reviews graded so far leave more due now (R-62, R-78). */
  readonly canContinue: boolean;
  /** Where the repertoires stand now, by the Reviews graded so far. */
  readonly progress: () => TrainingProgress;
}

type SetState = Dispatch<SetStateAction<DrillState>>;

const putBack = (s: DrillState): DrillState => ({
  ...s,
  revision: s.revision + 1,
});

/**
 * The drill's timed steps: after the correct flash the next item, then the
 * reply's slide with the board locked, and each flash's end.
 */
function useDrillTimers(
  state: DrillState,
  setState: SetState,
  repertoires: readonly TrainingRepertoire[],
): void {
  const next = useMemo(
    () => () => {
      setState((s) => advanced(s, repertoires));
    },
    [setState, repertoires],
  );
  useTimer(state.session.phase === 'correct', FEEDBACK_MS, next);
  const unlock = useMemo(
    () => () => {
      setState((s) => ({ ...s, replying: false }));
    },
    [setState],
  );
  useTimer(state.replying, MOVE_DURATION, unlock);
  const { flash } = state;
  const unflash = useMemo(
    () => () => {
      setState((s) => (s.flash === flash ? { ...s, flash: null } : s));
    },
    [setState, flash],
  );
  useTimer(flash !== null, FEEDBACK_MS, unflash);
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
    play(move) {
      const now = clock.now();
      const answer = answerReview(state.session, move.san);
      record(answer.emit, now);
      setState(afterAnswer(state, move, answer, now));
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
      const hinted = hintReview(state.session);
      record(hinted.emit, now);
      setState(afterHint(state, hinted, now));
    },
    restart() {
      const { gradedDay } = c;
      const due = dueReviews(gradedDay, clock.now());
      setState(
        startDrill(
          due,
          gradedDay.repertoires,
          gradedDay.reviews,
          state.revision + 1,
        ),
      );
    },
  };
}

/** The side the shown item's repertoire plays (the board's orientation). */
const sideOf = (data: TrainingData, state: DrillState): Side =>
  data.entries.find((e) => e.id === state.shown?.item.repertoireId)?.side ??
  'white';

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
  const [state, setState] = useState(() =>
    startDrill(dueReviews(day, data.now), repertoires, day.reviews, 0),
  );
  const key = shownKey(state);
  const legal = useMemo(() => legalMoves(key), [key]);
  const side = sideOf(data, state);
  const view = useMemo(
    () => drillBoard(state, side, legal),
    [state, side, legal],
  );
  const gradedDay = useMemo(
    () => ({ ...day, reviews: state.reviews }),
    [day, state.reviews],
  );
  useDrillTimers(state, setState, repertoires);
  useDueAgain(state, gradedDay, clock);
  const input = useDrillInput({
    gradedDay,
    state,
    setState,
    legal,
    sync,
    clock,
  });
  const done = isDone(state);
  return {
    ...input,
    state,
    view,
    canContinue: done && dueCount(gradedDay, clock.now()) > 0,
    progress: () => trainingProgress(gradedDay, clock.now()),
  };
}
