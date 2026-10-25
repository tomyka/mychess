'use client';

import type { Key } from '@lichess-org/chessground/types';
import {
  answerReview,
  findLegalMove,
  hintReview,
  legalMoves,
  type BoardMove,
  type Promotion,
  type ReviewEmit,
  type ReviewState,
  type Side,
  type TrainingRepertoire,
} from '@mychess/chess';
import {
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { TrainingData } from '../../server/training';
import { MOVE_DURATION, type BoardView } from '../board/board-config';
import { movesBetween } from '../repertoire-view';
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
import {
  repertoireProgress,
  type RepertoireProgress,
} from './session-progress';
import { dueReviews, repertoiresOf, reviewsOf } from './training-start';
import type { ResultSync } from './use-result-sync';

/** The `duration-feedback` token (tokens.css): a square's answer flash. */
const FEEDBACK_MS = 400;

/** The longest wait `setTimeout` keeps (about 24.8 days). */
const MAX_TIMER_MS = 2 ** 31 - 1;

/** The drill's time and result ids, so a test can fix them. */
export interface DrillClock {
  now(): Date;
  newId(): string;
}

const BROWSER_CLOCK: DrillClock = {
  now: () => new Date(),
  newId: () => crypto.randomUUID(),
};

/** What the player does on the board and in the panel. */
interface DrillInput {
  /** A pawn's move to the last rank, waiting for its piece. */
  readonly promotion: readonly BoardMove[] | null;
  readonly onMove: (orig: Key, dest: Key) => void;
  /** Whether the typed move was taken (the field clears only then). */
  readonly onTyped: (text: string) => boolean;
  readonly pick: (piece: Promotion) => void;
  readonly cancel: () => void;
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
  readonly progress: () => RepertoireProgress;
}

type SetState = Dispatch<SetStateAction<DrillState>>;

const putBack = (s: DrillState): DrillState => ({
  ...s,
  revision: s.revision + 1,
});

/** Runs `step` after `ms` while `on` holds; a change of `on` or `step` resets it. */
function useTimer(on: boolean, ms: number, step: () => void): void {
  useEffect(() => {
    if (!on) return undefined;
    const timer = setTimeout(step, ms);
    return () => {
      clearTimeout(timer);
    };
  }, [on, ms, step]);
}

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

/** The first of `reviews` due after `now`, in ms from now, if a timer can wait that long. */
function nextDueIn(
  reviews: ReadonlyMap<string, ReviewState>,
  now: number,
): number | null {
  const later = [...reviews.values()]
    .map((r) => r.fsrs.due.getTime() - now)
    .filter((wait) => wait > 0);
  const wait = Math.min(...later);
  return wait <= MAX_TIMER_MS ? wait : null;
}

/**
 * Once done, renders again when the next graded Review comes due: a Lapse
 * is due within minutes (R-78), and "continue" then has something to offer.
 */
function useDueAgain(state: DrillState, clock: DrillClock): void {
  const [tick, setTick] = useState(0);
  const done = isDone(state);
  const { reviews } = state;
  useEffect(() => {
    const wait = done ? nextDueIn(reviews, clock.now().getTime()) : null;
    if (wait === null) return undefined;
    const timer = setTimeout(() => {
      setTick(tick + 1);
    }, wait);
    return () => {
      clearTimeout(timer);
    };
  }, [done, reviews, clock, tick]);
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
  readonly data: TrainingData;
  readonly repertoires: readonly TrainingRepertoire[];
  readonly state: DrillState;
  readonly setState: SetState;
  readonly legal: readonly BoardMove[];
  readonly sync: ResultSync;
  readonly clock: DrillClock;
}

/** Each answer is recorded once it is made and graded in the local Reviews. */
function useDrillInput(c: InputContext): DrillInput {
  const { state, setState, clock } = c;
  const [promotion, setPromotion] = useState<readonly BoardMove[] | null>(null);
  const record = recorder(c.sync, clock);

  function play(move: BoardMove): void {
    const now = clock.now();
    const answer = answerReview(state.session, move.san);
    record(answer.emit, now);
    setState(afterAnswer(state, move, answer, now));
  }

  return {
    promotion,
    onMove(orig, dest) {
      const options = movesBetween(c.legal, orig, dest);
      const [only] = options;
      if (options.length > 1) setPromotion(options);
      else if (only !== undefined && canPlay(state)) play(only);
      else setState(putBack);
    },
    onTyped(text) {
      if (!canPlay(state)) return false;
      const move = findLegalMove(shownKey(state), text);
      if (move === null) setState({ ...state, unknownTyped: true });
      else play(move);
      return move !== null;
    },
    pick(piece) {
      const move = promotion?.find((m) => m.promotion === piece);
      setPromotion(null);
      if (move !== undefined) play(move);
    },
    cancel() {
      setPromotion(null);
      setState(putBack);
    },
    hint() {
      if (!canHint(state)) return;
      const now = clock.now();
      const hinted = hintReview(state.session);
      record(hinted.emit, now);
      setState(afterHint(state, hinted, now));
    },
    restart() {
      setPromotion(null);
      const due = dueReviews(c.data, state.reviews, clock.now());
      setState(
        startDrill(due, c.repertoires, state.reviews, state.revision + 1),
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
  const repertoires = useMemo(() => repertoiresOf(data), [data]);
  const [state, setState] = useState(() => {
    const reviews = reviewsOf(data);
    const due = dueReviews(data, reviews, data.now);
    return startDrill(due, repertoires, reviews, 0);
  });
  const key = shownKey(state);
  const legal = useMemo(() => legalMoves(key), [key]);
  const side = sideOf(data, state);
  const view = useMemo(
    () => drillBoard(state, side, legal),
    [state, side, legal],
  );
  useDrillTimers(state, setState, repertoires);
  useDueAgain(state, clock);
  const input = useDrillInput({
    data,
    repertoires,
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
    canContinue:
      done && dueReviews(data, state.reviews, clock.now()).length > 0,
    progress: () =>
      repertoireProgress(data.entries, state.reviews, clock.now()),
  };
}
