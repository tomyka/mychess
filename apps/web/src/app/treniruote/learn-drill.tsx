'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { JSX } from 'react';
import type { TrainingData } from '../../lib/training-data';
import { Board } from '../board/board';
import { useSquareWords } from '../board/square-words';
import { SECONDARY_BUTTON } from '../buttons';
import { DoneSummary } from './done-summary';
import type { DrillProps, FrameParts } from './drill';
import { LineSoFar, MoveRow, ToMove } from './drill-panel';
import {
  askedStep,
  isDone,
  learnCounts,
  playedMoves,
  repertoireOf,
  type LearnDrillState,
} from './learn-drill-state';
import { useLearnDrill, type LearnDrill as Drill } from './use-learn-drill';

type PromptKey = 'correct' | 'wrong' | 'known' | 'arrows' | 'blind';

/** What the panel asks (docs/design/training-screen.md, Learn pass). */
function promptOf(state: LearnDrillState): PromptKey {
  if (state.hold !== null) return 'correct';
  if (state.wrong && state.session?.arrow === true) return 'wrong';
  if (askedStep(state)?.kind === 'known') return 'known';
  return state.session?.round === 'blind' ? 'blind' : 'arrows';
}

const TONES: Record<PromptKey, string> = {
  correct: 'text-success',
  wrong: 'text-error',
  known: 'text-fg',
  arrows: 'text-fg',
  blind: 'text-fg',
};

/**
 * The live line: the side to move, what is asked and the answer's result,
 * heard as each comes. A move the player knows is played for its line.
 */
function Status({ drill }: { readonly drill: Drill }): JSX.Element {
  const t = useTranslations();
  const { state } = drill;
  const prompt = promptOf(state);
  return (
    <div aria-live="polite" className="flex flex-col gap-1">
      <ToMove color={drill.view.turnColor} />
      <p className={`text-lg font-medium ${TONES[prompt]}`}>
        {t(`training.learn.${prompt}`)}
      </p>
      {state.unknownTyped ? (
        <p className="text-error">{t('board.moveInput.unknown')}</p>
      ) : null}
    </div>
  );
}

/** The line's repertoire name, as the frame's title (R-54). */
function titled(
  data: TrainingData,
  state: LearnDrillState,
): Partial<FrameParts> {
  const id = repertoireOf(state);
  const name = data.entries.find((e) => e.id === id)?.name;
  return name === undefined ? {} : { title: name };
}

/**
 * The learn drill (docs/design/training-screen.md, R-144): the planned
 * lines one after another, each played with arrows on its new moves and
 * then blind, the opponent's moves played for the player, until the done
 * summary. The plan already takes all that today's allowance allows, so
 * the summary offers no "continue".
 */
export function LearnDrill({
  data,
  sync,
  links,
  frame,
  clock,
}: DrillProps): JSX.Element {
  const t = useTranslations();
  const drill = useLearnDrill(data, sync, clock);
  const describe = useSquareWords(drill.view.fen);
  const { state } = drill;
  const counts = learnCounts(state);
  const parts = { ...titled(data, state), progress: counts };
  const board = (
    <Board
      view={drill.view}
      label={t('board.label')}
      describe={describe}
      onMove={drill.onMove}
    />
  );
  if (isDone(state))
    return frame({
      ...parts,
      board,
      finished: true,
      panel: (
        <DoneSummary
          counts={{ kind: 'learn', learned: counts.done }}
          progress={drill.progress()}
          doneHref={links.back}
        />
      ),
    });
  return frame({
    ...parts,
    board,
    panel: (
      <>
        <Status drill={drill} />
        <MoveRow input={drill} color={drill.view.turnColor} />
        <LineSoFar
          moves={playedMoves(state)}
          rootKey={state.session?.line.rootKey}
        />
      </>
    ),
    actions: (
      <Link href={links.back} className={SECONDARY_BUTTON}>
        {t('training.review.end')}
      </Link>
    ),
  });
}
