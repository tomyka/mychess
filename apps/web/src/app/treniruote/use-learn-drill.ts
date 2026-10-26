'use client';

import {
  learnLines,
  legalMoves,
  playLearn,
  trainingProgress,
  type BoardMove,
  type Side,
  type TrainingProgress,
} from '@mychess/chess';
import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
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
  afterPlay,
  canPlay,
  learnBoard,
  opponentMoving,
  released,
  repertoireOf,
  shownKey,
  startLearnDrill,
  type LearnDrillState,
} from './learn-drill-state';
import { dayOf } from '../../lib/training-day';
import type { ResultSync } from './use-result-sync';

export interface LearnDrill extends MoveInput {
  readonly state: LearnDrillState;
  readonly view: BoardView;
  /** Where the repertoires stand now, by the moves learned so far. */
  readonly progress: () => TrainingProgress;
}

type SetState = Dispatch<SetStateAction<LearnDrillState>>;

/**
 * The drill's timed steps: the right move held for its flash, the
 * opponent's move sliding in with the board locked, and a wrong flash's end.
 */
function useLearnTimers(state: LearnDrillState, setState: SetState): void {
  const release = useMemo(
    () => () => {
      setState(released);
    },
    [setState],
  );
  useTimer(state.hold !== null, FEEDBACK_MS, release);
  const advance = useMemo(
    () => () => {
      setState(advanced);
    },
    [setState],
  );
  useTimer(opponentMoving(state), MOVE_DURATION, advance);
  const { flash } = state;
  const unflash = useMemo(
    () => () => {
      setState((s) => (s.flash === flash ? { ...s, flash: null } : s));
    },
    [setState, flash],
  );
  useTimer(flash?.kind === 'wrong', FEEDBACK_MS, unflash);
}

interface InputContext {
  readonly state: LearnDrillState;
  readonly setState: SetState;
  readonly legal: readonly BoardMove[];
  readonly sync: ResultSync;
  readonly clock: DrillClock;
}

/** Each move is played in the session; a move learned is recorded once (R-55). */
function useLearnInput(c: InputContext): MoveInput {
  const { state, setState, sync, clock } = c;
  return useMoveInput({
    position: shownKey(state),
    legal: c.legal,
    canPlay: canPlay(state),
    play(move) {
      if (state.session === null) return;
      const now = clock.now();
      const played = playLearn(state.session, move.san, now);
      if (played.emit !== null)
        sync.record({
          resultId: clock.newId(),
          kind: 'learned',
          moveKey: played.emit.key,
          repertoireId: state.session.line.repertoireId,
          answeredAt: now,
        });
      setState(afterPlay(state, move, played, now));
    },
    putBack() {
      setState((s) => ({ ...s, revision: s.revision + 1 }));
    },
    unknown() {
      setState({ ...state, unknownTyped: true });
    },
  });
}

/** The side the line's repertoire plays (the board's orientation). */
const sideOf = (data: TrainingData, state: LearnDrillState): Side =>
  data.entries.find((e) => e.id === repertoireOf(state))?.side ?? 'white';

/**
 * The learn drill (plan Task C6): the plan's lines one after another, each
 * learned in its two rounds, each move learned recorded and started as a
 * Review in the browser, and the board's view of it.
 */
export function useLearnDrill(
  data: TrainingData,
  sync: ResultSync,
  clock: DrillClock = BROWSER_CLOCK,
): LearnDrill {
  const day = useMemo(() => dayOf(data), [data]);
  const [state, setState] = useState(() =>
    startLearnDrill(learnLines(day), day.reviews),
  );
  const key = shownKey(state);
  const legal = useMemo(() => legalMoves(key), [key]);
  const side = sideOf(data, state);
  const view = useMemo(
    () => learnBoard(state, side, legal),
    [state, side, legal],
  );
  useLearnTimers(state, setState);
  const input = useLearnInput({ state, setState, legal, sync, clock });
  return {
    ...input,
    state,
    view,
    progress: () =>
      trainingProgress(
        { repertoires: day.repertoires, reviews: state.reviews },
        clock.now(),
      ),
  };
}
