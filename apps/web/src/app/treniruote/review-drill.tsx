'use client';

import { reviewCounts } from '@mychess/chess';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useMemo, type JSX } from 'react';
import type { TrainingData } from '../../server/training';
import { Board } from '../board/board';
import { MoveInput } from '../board/move-input';
import { PromotionPicker } from '../board/promotion-picker';
import { useSquareWords } from '../board/square-words';
import { SECONDARY_BUTTON } from '../buttons';
import { DoneSummary } from './done-summary';
import type { DrillProps, FrameParts } from './drill';
import {
  canHint,
  lineText,
  playedMoves,
  replyText,
  sessionCounts,
  type DrillState,
} from './review-drill-state';
import { toLearn } from './training-start';
import { TwoAnswersNotice, type NamedRepertoire } from './two-answers-notice';
import {
  useReviewDrill,
  type DrillClock,
  type ReviewDrill as Drill,
} from './use-review-drill';

export interface ReviewDrillProps extends DrillProps {
  /** The drill's time and result ids; the browser's by default. */
  readonly clock?: DrillClock;
}

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
      <p className="flex items-center gap-2 text-sm text-fg-muted">
        <span
          aria-hidden="true"
          className={`size-3 rounded-full border border-border-strong ${drill.view.turnColor === 'white' ? 'bg-white' : 'bg-black'}`}
        />
        {t(`training.review.toMove.${drill.view.turnColor}`)}
      </p>
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

/** The typed-move field, or the promotion choice in its place. */
function MoveRow({ drill }: { readonly drill: Drill }): JSX.Element {
  if (drill.promotion !== null)
    return (
      <PromotionPicker
        color={drill.view.turnColor}
        onPick={drill.pick}
        onCancel={drill.cancel}
      />
    );
  return <MoveInput onTyped={drill.onTyped} />;
}

/** The moves so far on the item's line, newest last. */
function LineSoFar({ state }: { readonly state: DrillState }): JSX.Element {
  const t = useTranslations('training.review');
  const moves = playedMoves(state);
  const rootKey = state.shown?.line.rootKey;
  return (
    <div>
      <h2 className="sr-only">{t('line')}</h2>
      {rootKey === undefined || moves.length === 0 ? null : (
        <p className="overflow-x-auto text-sm whitespace-nowrap text-fg-muted tabular-nums">
          {lineText(moves, rootKey)}
        </p>
      )}
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
      <MoveRow drill={drill} />
      <button
        type="button"
        onClick={drill.hint}
        aria-disabled={!canHint(drill.state)}
        className={`${SECONDARY_BUTTON} self-start aria-disabled:opacity-60`}
      >
        {t('hint')}
      </button>
      <LineSoFar state={drill.state} />
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
}: ReviewDrillProps): JSX.Element {
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
        {t('training.review.end')}
      </Link>
    ),
  });
}
