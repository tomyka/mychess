'use client';

import { reviewProgress, type RepertoireMove } from '@mychess/chess';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { JSX } from 'react';
import { Board } from '../board/board';
import { useSquareWords } from '../board/square-words';
import { QUIET_ACTION, TONAL_BUTTON } from '../buttons';
import { NextButton } from './next-button';
import { DrillCoachNote } from './coach-note';
import { DoneActions, DoneSummary } from './done-summary';
import type { DrillProps } from './drill';
import {
  LineSoFar,
  MoveRow,
  StatusLine,
  ToMove,
  type StatusTone,
} from './drill-panel';
import {
  canHint,
  isRepeat,
  playedMoves,
  replyText,
  sessionCounts,
  type DrillState,
} from './review-drill-state';
import { TwoAnswersNotice } from './two-answers-notice';
import { useReviewDrill, type ReviewDrill as Drill } from './use-review-drill';

type StatusKey = 'correct' | 'lapse' | 'hinted' | 'again' | 'prompt';

/** What the panel says about the current answer. */
function statusOf(state: DrillState): StatusKey {
  if (state.session.phase === 'correct') return 'correct';
  if (state.session.phase === 'replay') return 'lapse';
  if (state.session.hinted) return 'hinted';
  return isRepeat(state) ? 'again' : 'prompt';
}

const TONES: Record<StatusKey, StatusTone> = {
  correct: 'success',
  lapse: 'error',
  hinted: 'due',
  again: 'due',
  prompt: 'prompt',
};

/**
 * The live line (docs/design/training-screen.md): the side to move, the
 * opponent's reply, and the answer's result, heard as each comes.
 */
function Status({ drill }: { readonly drill: Drill }): JSX.Element {
  const t = useTranslations();
  const { state } = drill;
  const status = statusOf(state);
  const reply =
    state.shown === null || state.session.phase !== 'ask'
      ? null
      : replyText(state.shown);
  return (
    <div aria-live="polite" className="flex flex-col gap-1">
      <ToMove color={drill.view.turnColor} />
      {reply === null ? null : (
        <p>{t('training.review.replied', { move: reply })}</p>
      )}
      <StatusLine tone={TONES[status]} text={t(`training.review.${status}`)} />
      {state.unknownTyped ? (
        <p className="text-error">{t('board.moveInput.unknown')}</p>
      ) : null}
    </div>
  );
}

function ReviewPanel({ drill }: { readonly drill: Drill }): JSX.Element {
  const t = useTranslations('training.review');
  return (
    <>
      <Status drill={drill} />
      {/* While a coach note or the two-answers notice holds the drill only
          it and Next count: the move field and Hint cannot be used, and on
          a portrait tablet they would push the note out of the panel. */}
      {drill.next === null ? (
        <MoveRow input={drill} color={drill.view.turnColor}>
          <button
            type="button"
            onClick={drill.hint}
            aria-disabled={!canHint(drill.state)}
            className={TONAL_BUTTON}
          >
            {t('hint')}
          </button>
        </MoveRow>
      ) : null}
      <DrillCoachNote notes={drill.notes} />
      <TwoAnswersNotice answers={drill.answers} />
      <LineSoFar
        moves={unannotated(playedMoves(drill.state))}
        rootKey={drill.state.shown?.line.rootKey}
      />
    </>
  );
}

/**
 * `moves` without their NAGs: a review shows the board, not annotations, so
 * its line so far shows no glyphs (#325 decision 6).
 */
const unannotated = (
  moves: readonly RepertoireMove[],
): readonly RepertoireMove[] => moves.map((m) => ({ ...m, nags: [] }));

/**
 * The review drill (docs/design/training-screen.md): the Due Reviews one at
 * a time, each in its repertoire and after its line so far (R-143), until
 * the done summary.
 */
export function ReviewDrill({
  data,
  sync,
  links,
  frame,
  clock,
}: DrillProps): JSX.Element {
  const t = useTranslations();
  const drill = useReviewDrill(data, sync, clock);
  const describe = useSquareWords(drill.view.fen);
  const { state } = drill;
  const parts = { item: drill.item, progress: reviewProgress(state.session) };
  const board = (
    <Board
      view={drill.view}
      label={t('board.label')}
      describe={describe}
      onMove={drill.onMove}
    />
  );
  if (state.session.current === null)
    return frame({
      ...parts,
      board,
      finished: true,
      panel: (
        <DoneSummary
          counts={sessionCounts(state)}
          progress={drill.progress()}
          standing={drill.standing()}
        />
      ),
      actions: (
        <DoneActions
          {...(drill.canContinue ? { onContinue: drill.restart } : {})}
          {...(drill.learnable ? { learnHref: links.learn } : {})}
          doneHref={links.back}
        />
      ),
    });
  return frame({
    ...parts,
    board,
    panel: <ReviewPanel drill={drill} />,
    actions: (
      <>
        {drill.next === null ? null : <NextButton onNext={drill.next} />}
        <Link href={links.back} className={QUIET_ACTION}>
          {t('training.drill.end')}
        </Link>
      </>
    ),
  });
}
