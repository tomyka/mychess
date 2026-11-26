'use client';

import { reviewProgress, type RepertoireMove } from '@mychess/chess';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';
import { TONAL_BUTTON } from '../buttons';
import type { DrillProps } from './drill';
import { DrillShell } from './drill-shell';
import {
  canHint,
  isRepeat,
  playedMoves,
  replyText,
  sessionCounts,
  type ReviewDrillState,
} from './review-drill-state';
import { useReviewDrill } from './use-review-drill';

type StatusKey = 'correct' | 'lapse' | 'hinted' | 'again' | 'prompt';

/** What the panel says about the current answer. */
function statusOf(state: ReviewDrillState): StatusKey {
  if (state.session.phase === 'correct') return 'correct';
  if (state.session.phase === 'replay') return 'lapse';
  if (state.session.hinted) return 'hinted';
  return isRepeat(state) ? 'again' : 'prompt';
}

/** The opponent's reply before the asked move, while it is asked. */
const replyOf = (state: ReviewDrillState): string | null =>
  state.shown === null || state.session.phase !== 'ask'
    ? null
    : replyText(state.shown);

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
 * the done summary. Its live line says the opponent's reply and the
 * answer's result; Hint sits beside the move field.
 */
export function ReviewDrill({
  data,
  sync,
  links,
  frame,
  clock,
}: DrillProps): JSX.Element {
  const t = useTranslations('training.review');
  const drill = useReviewDrill(data, sync, clock);
  const { state } = drill;
  const status = statusOf(state);
  const reply = replyOf(state);
  return (
    <DrillShell
      drill={drill}
      links={links}
      frame={frame}
      progress={reviewProgress(state.session)}
      counts={sessionCounts(state)}
      status={{ key: status, text: t(status) }}
      said={reply === null ? null : <p>{t('replied', { move: reply })}</p>}
      tools={
        <button
          type="button"
          onClick={drill.hint}
          aria-disabled={!canHint(state)}
          className={TONAL_BUTTON}
        >
          {t('hint')}
        </button>
      }
      line={{
        moves: unannotated(playedMoves(state)),
        rootKey: state.shown?.line.rootKey,
      }}
    />
  );
}
