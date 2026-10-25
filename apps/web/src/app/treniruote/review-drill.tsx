'use client';

import { reviewCounts } from '@mychess/chess';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useMemo, type JSX } from 'react';
import type { TrainingData } from '../../lib/training-data';
import { Board } from '../board/board';
import { useSquareWords } from '../board/square-words';
import { SECONDARY_BUTTON } from '../buttons';
import { DoneSummary } from './done-summary';
import type { DrillProps, FrameParts } from './drill';
import { LineSoFar, MoveRow, ToMove } from './drill-panel';
import {
  canHint,
  playedMoves,
  replyText,
  sessionCounts,
  type DrillState,
} from './review-drill-state';
import { toLearn } from '../../lib/training-counts';
import { TwoAnswersNotice, type NamedRepertoire } from './two-answers-notice';
import { useReviewDrill, type ReviewDrill as Drill } from './use-review-drill';

type StatusKey = 'correct' | 'lapse' | 'hinted' | 'prompt';

/** What the panel says about the current answer. */
function statusOf(state: DrillState): StatusKey {
  if (state.session.phase === 'correct') return 'correct';
  if (state.session.phase === 'replay') return 'lapse';
  return state.session.hinted ? 'hinted' : 'prompt';
}

const TONES: Record<StatusKey, string> = {
  correct: 'text-success',
  lapse: 'text-error',
  hinted: 'text-fg',
  prompt: 'text-fg',
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
      <p className={`text-lg font-medium ${TONES[status]}`}>
        {t(`training.review.${status}`)}
      </p>
      {state.unknownTyped ? (
        <p className="text-error">{t('board.moveInput.unknown')}</p>
      ) : null}
    </div>
  );
}

function ReviewPanel({
  drill,
  named,
}: {
  readonly drill: Drill;
  readonly named: readonly NamedRepertoire[];
}): JSX.Element {
  const t = useTranslations('training.review');
  const item = drill.state.session.current?.item;
  return (
    <>
      <Status drill={drill} />
      <MoveRow input={drill} color={drill.view.turnColor} />
      <button
        type="button"
        onClick={drill.hint}
        aria-disabled={!canHint(drill.state)}
        className={`${SECONDARY_BUTTON} self-start aria-disabled:opacity-60`}
      >
        {t('hint')}
      </button>
      <LineSoFar
        moves={playedMoves(drill.state)}
        rootKey={drill.state.shown?.line.rootKey}
      />
      {item === undefined ? null : (
        <TwoAnswersNotice item={item} repertoires={named} />
      )}
    </>
  );
}

/** Every repertoire the player trains, by name: the session's and the others. */
const namedOf = (data: TrainingData): NamedRepertoire[] =>
  [...data.entries, ...data.others].map(({ id, name, graph }) => ({
    id,
    name,
    graph,
  }));

/** The shown item's repertoire name, as the frame's title (R-54). */
function titled(data: TrainingData, state: DrillState): Partial<FrameParts> {
  const id = state.shown?.item.repertoireId;
  const name = data.entries.find((e) => e.id === id)?.name;
  return name === undefined ? {} : { title: name };
}

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
  const named = useMemo(() => namedOf(data), [data]);
  const learnable = useMemo(() => toLearn(data) > 0, [data]);
  const { state } = drill;
  const parts = {
    ...titled(data, state),
    progress: reviewCounts(state.session),
  };
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
          counts={sessionCounts(state.session)}
          progress={drill.progress()}
          {...(drill.canContinue ? { onContinue: drill.restart } : {})}
          {...(learnable ? { learnHref: links.learn } : {})}
          doneHref={links.back}
        />
      ),
    });
  return frame({
    ...parts,
    board,
    panel: <ReviewPanel drill={drill} named={named} />,
    actions: (
      <Link href={links.back} className={SECONDARY_BUTTON}>
        {t('training.drill.end')}
      </Link>
    ),
  });
}
