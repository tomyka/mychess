'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { JSX } from 'react';
import { Board } from '../board/board';
import { useSquareWords } from '../board/square-words';
import { SECONDARY_BUTTON } from '../buttons';
import { DoneActions, DoneSummary } from './done-summary';
import type { DrillProps } from './drill';
import { LineSoFar, MoveRow, ToMove } from './drill-panel';
import {
  askedStep,
  isDone,
  learnCounts,
  opponentMoving,
  playedMoves,
  type LearnDrillState,
} from './learn-drill-state';
import { DrillCoachNote } from './coach-note';
import { NextButton } from './next-button';
import { TwoAnswersNotice } from './two-answers-notice';
import { useLearnDrill, type LearnDrill as Drill } from './use-learn-drill';

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
 * "again".
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

const TONES: Record<PromptKey, string> = {
  correct: 'text-success',
  wrong: 'text-error',
  known: 'text-fg',
  arrows: 'text-fg',
  blind: 'text-fg',
  recall: 'text-fg',
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

/**
 * What is asked, the move field, the taught move's Coach note, the line.
 * While a note holds the drill only it and Next count, as in a review.
 */
function LearnPanel({ drill }: { readonly drill: Drill }): JSX.Element {
  const { state } = drill;
  return (
    <>
      <Status drill={drill} />
      {drill.next === null ? (
        <MoveRow input={drill} color={drill.view.turnColor} />
      ) : null}
      <DrillCoachNote notes={drill.notes} />
      <TwoAnswersNotice answers={drill.answers} />
      <LineSoFar
        moves={playedMoves(state)}
        rootKey={state.session?.line.rootKey}
      />
    </>
  );
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
  const parts = { item: drill.item, progress: counts };
  const board = (
    <Board
      view={drill.view}
      label={t('board.label')}
      describe={describe}
      onMove={drill.onMove}
    />
  );
  if (isDone(state)) {
    const standing = drill.standing();
    return frame({
      ...parts,
      board,
      finished: true,
      panel: (
        <DoneSummary
          counts={{ kind: 'learn', learned: counts.done }}
          progress={drill.progress()}
          standing={standing}
        />
      ),
      actions: (
        <DoneActions
          doneHref={links.back}
          {...(standing.kind === 'due' ? { reviewHref: links.review } : {})}
        />
      ),
    });
  }
  return frame({
    ...parts,
    board,
    panel: <LearnPanel drill={drill} />,
    actions: (
      <>
        {drill.next === null ? null : <NextButton onNext={drill.next} />}
        <Link href={links.back} className={SECONDARY_BUTTON}>
          {t('training.drill.end')}
        </Link>
      </>
    ),
  });
}
