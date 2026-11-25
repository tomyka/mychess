'use client';

import {
  dayStanding,
  learnLines,
  playLearn,
  trainingProgress,
  type BoardMove,
  type DayStanding,
  type TrainingProgress,
} from '@mychess/chess';
import { dayEnd } from '@mychess/domain';
import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
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
  afterPlay,
  answering,
  canPlay,
  canType,
  opponentMoving,
  positionOf,
  released,
  repertoireOf,
  chapterOf,
  shownKey,
  startLearnDrill,
  taughtMove,
  type LearnDrillState,
} from './learn-drill-state';
import {
  drillNotices,
  hasNotices,
  namedOf,
  type DrillNotices,
} from './drill-notices';
import { dayOf } from '../../lib/training-day';
import type { ResultSync } from './use-result-sync';

export interface LearnDrill
  extends
    MoveInput,
    DrillNotices,
    Pick<DrillBoard, 'view' | 'item' | 'toMove'> {
  readonly state: LearnDrillState;
  /**
   * On to the next step, once a blind answer's Coach notes or two-answers
   * notice hold the drill (arrows off, lead answer 3); null while none do.
   */
  readonly next: (() => void) | null;
  /** Where the repertoires stand now, by the moves learned so far. */
  readonly progress: () => TrainingProgress;
  /** Where the player's day stands now (#319). */
  readonly standing: () => DayStanding;
}

type SetState = Dispatch<SetStateAction<LearnDrillState>>;

/**
 * The drill's timed steps: the right move held for its flash, unless a
 * Coach note waits to be read (`held`), and the opponent's move sliding in
 * with the board locked. Returns the release, for the note's button.
 */
function useLearnTimers(
  state: LearnDrillState,
  setState: SetState,
  held: boolean,
): () => void {
  const release = useMemo(
    () => () => {
      setState(released);
    },
    [setState],
  );
  useTimer(state.hold !== null && !held, FEEDBACK_MS, release);
  const advance = useMemo(
    () => () => {
      setState(advanced);
    },
    [setState],
  );
  useTimer(opponentMoving(state), MOVE_DURATION, advance);
  return release;
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
    canType: canType(state),
    play(move) {
      const base = answering(state);
      if (base.session === null) return;
      const now = clock.now();
      const played = playLearn(base.session, move.san, now);
      if (played.emit !== null)
        sync.record({
          resultId: clock.newId(),
          kind: 'learned',
          moveKey: played.emit.key,
          repertoireId: base.session.line.repertoireId,
          answeredAt: now,
        });
      setState(afterPlay(base, move, played, now));
    },
    putBack() {
      setState((s) => ({ ...s, revision: s.revision + 1 }));
    },
    unknown() {
      setState({ ...state, unknownTyped: true });
    },
  });
}

/**
 * The learn drill (plan Task C6): the plan's lines one after another, each
 * learned in its two rounds (only the blind one with arrows off, R-205),
 * each move learned recorded and started as a Review in the browser, and
 * the board's view of it.
 */
export function useLearnDrill(
  data: TrainingData,
  sync: ResultSync,
  clock: DrillClock = BROWSER_CLOCK,
): LearnDrill {
  const day = useMemo(() => dayOf(data), [data]);
  const [state, setState] = useState(() =>
    startLearnDrill(learnLines(day), day.reviews, {
      arrows: data.settings.learnArrows,
    }),
  );
  const named = useMemo(() => namedOf(data), [data]);
  const notices = drillNotices(
    data,
    named,
    repertoireOf(state),
    taughtMove(state),
  );
  // Only a blind answer's notices hold the drill: the arrow's show while
  // it is asked, before the answer.
  const held = state.answered !== null && hasNotices(notices);
  const release = useLearnTimers(state, setState, held);
  const { view, legal, item, toMove } = useDrillBoard({
    data,
    state,
    setState,
    positionOf,
    repertoireOf,
    chapterOf,
  });
  const input = useLearnInput({ state, setState, legal, sync, clock });
  const progressAt = (now: Date) =>
    trainingProgress(
      { repertoires: day.repertoires, reviews: state.reviews },
      now,
    );
  return {
    ...input,
    state,
    view,
    item,
    toMove,
    ...notices,
    next: held ? release : null,
    progress: () => progressAt(clock.now()),
    standing: () => {
      const now = clock.now();
      return dayStanding(progressAt(now), dayEnd(now));
    },
  };
}
