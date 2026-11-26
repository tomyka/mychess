'use client';

import { learnLines, playLearn, type BoardMove } from '@mychess/chess';
import type { TrainingData } from '../../lib/training-data';
import type { Step } from './drill-core';
import { NOTHING_MORE } from './done-offer';
import { BROWSER_CLOCK, type DrillClock } from './drill-input';
import {
  advanced,
  afterPlay,
  answering,
  frameOf,
  isDone,
  opponentMoving,
  released,
  startLearnDrill,
  taughtMove,
  type LearnDrillState,
} from './learn-drill-state';
import { useDrill, type Drill, type DrillRules } from './use-drill';
import type { ResultSync } from './use-result-sync';

export type LearnDrill = Drill<LearnDrillState>;

/**
 * The player's `move`, played in the session at `now`; a move learned is
 * recorded once (R-55). A move typed while the opponent's move slides in
 * answers the position after it.
 */
function played(
  s: LearnDrillState,
  move: BoardMove,
  now: Date,
): Step<LearnDrillState> {
  const base = answering(s);
  if (base.session === null) return { state: s, result: null };
  const answer = playLearn(base.session, move.san, now);
  const { emit } = answer;
  return {
    state: afterPlay(base, move, answer, now),
    result:
      emit === null
        ? null
        : {
            kind: 'learned',
            moveKey: emit.key,
            repertoireId: base.session.line.repertoireId,
          },
  };
}

/**
 * How the learn drill goes: the plan's lines one after another, each
 * learned in its two rounds (only the blind one with arrows off, R-205);
 * a right move is held for its flash, and only a blind answer's notices
 * hold it until Next (lead answer 3): the arrow's show while it is asked.
 */
const LEARN_RULES: DrillRules<LearnDrillState> = {
  start: ({ day, data }) =>
    startLearnDrill(learnLines(day), day.reviews, {
      arrows: data.settings.learnArrows,
    }),
  frameOf,
  play: played,
  noticed: (s) => ({ move: taughtMove(s), holds: s.answered !== null }),
  answeredRight: (s) => s.hold !== null,
  onward: released,
  sliding: opponentMoving,
  slid: advanced,
  isDone,
  // The plan already takes all that today's allowance allows: no Continue.
  offer: ({ due }) => ({ ...NOTHING_MORE, review: due }),
};

/**
 * The learn drill (plan Task C6): each move learned recorded and started
 * as a Review in the browser, and the board's view of it. The learn mode's
 * entry point: the drill core run over the learn rules, which add nothing
 * of their own to it (a review adds its Hint).
 */
export function useLearnDrill(
  data: TrainingData,
  sync: ResultSync,
  clock: DrillClock = BROWSER_CLOCK,
): LearnDrill {
  return useDrill(LEARN_RULES, { data, sync, clock }).drill;
}
