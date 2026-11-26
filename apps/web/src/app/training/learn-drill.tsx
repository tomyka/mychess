'use client';

import { useTranslations } from 'next-intl';
import type { JSX } from 'react';
import type { DrillProps } from './drill';
import { DrillShell } from './drill-shell';
import {
  askedStep,
  learnCounts,
  opponentMoving,
  playedMoves,
  type LearnDrillState,
} from './learn-drill-state';
import { useLearnDrill } from './use-learn-drill';

type PromptKey = 'correct' | 'wrong' | 'known' | 'arrows' | 'blind' | 'recall';

/**
 * After a right move, the opponent's reply slides in: the answer still
 * stands until the next move is asked (UX sign-off). At a line's start
 * nothing was answered yet.
 */
const answeredAwaitingReply = (state: LearnDrillState): boolean =>
  opponentMoving(state) && (state.session?.index ?? 0) > 0;

/**
 * What the panel asks (docs/design/training-screen.md, Learn pass): with
 * arrows off a new move is asked to be played from memory (R-205), not
 * "again". A move the player knows is played for its line.
 */
function promptOf(state: LearnDrillState): PromptKey {
  if (state.hold !== null || answeredAwaitingReply(state)) return 'correct';
  if (state.wrong && state.session?.arrow === true) return 'wrong';
  if (askedStep(state)?.kind === 'known') return 'known';
  return newMovePrompt(state);
}

/** How a new move is asked: with its arrow, blind again, or from memory (R-205). */
function newMovePrompt(state: LearnDrillState): PromptKey {
  if (state.session?.round !== 'blind') return 'arrows';
  return state.options.arrows ? 'blind' : 'recall';
}

/**
 * The learn drill (docs/design/training-screen.md, R-144): the planned
 * lines one after another, each played with arrows on its new moves and
 * then blind, the opponent's moves played for the player, until the done
 * summary.
 */
export function LearnDrill({
  data,
  sync,
  links,
  frame,
  clock,
}: DrillProps): JSX.Element {
  const t = useTranslations('training.learn');
  const drill = useLearnDrill(data, sync, clock);
  const { state } = drill;
  const counts = learnCounts(state);
  const prompt = promptOf(state);
  return (
    <DrillShell
      drill={drill}
      links={links}
      frame={frame}
      progress={counts}
      counts={{ kind: 'learn', learned: counts.done }}
      status={{ key: prompt, text: t(prompt) }}
      line={{
        moves: playedMoves(state),
        rootKey: state.session?.line.rootKey,
      }}
    />
  );
}
