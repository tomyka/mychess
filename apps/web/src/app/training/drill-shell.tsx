'use client';

// One drill shell for both modes (docs/design/training-screen.md, #384): the
// board, the panel (the live line, the move field, the taught move's
// notices, the line so far), the bottom bar (Next while a note holds the
// drill, End session) and, once the session is over, the Done summary with
// the steps the drill offers. A mode supplies only its words: what the live
// line says, what is said before it, the tools beside the move field, its
// counter, its line and its counts.
import type { RepertoireMove } from '@mychess/chess';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { JSX, ReactNode } from 'react';
import { Board } from '../board/board';
import { useSquareWords } from '../board/square-words';
import { QUIET_ACTION } from '../buttons';
import { DrillCoachNote } from './coach-note';
import { DoneActions, DoneSummary, type SessionCounts } from './done-summary';
import type { DrillProps, FrameParts } from './drill';
import type { DrillCore } from './drill-core';
import {
  LineSoFar,
  MoveRow,
  StatusLine,
  ToMove,
  type StatusTone,
} from './drill-panel';
import { NextButton } from './next-button';
import { TwoAnswersNotice } from './two-answers-notice';
import type { Drill } from './use-drill';

/** What the live line can say: a review's results and prompts, a learn pass's. */
type StatusKey =
  | 'correct'
  | 'lapse'
  | 'wrong'
  | 'hinted'
  | 'again'
  | 'prompt'
  | 'known'
  | 'arrows'
  | 'blind'
  | 'recall';

/** Each status's look: a right answer, a wrong one, a warning, or the prompt. */
const TONES: Record<StatusKey, StatusTone> = {
  correct: 'success',
  lapse: 'error',
  wrong: 'error',
  hinted: 'due',
  again: 'due',
  prompt: 'prompt',
  known: 'prompt',
  arrows: 'prompt',
  blind: 'prompt',
  recall: 'prompt',
};

export interface DrillShellProps extends Pick<DrillProps, 'links' | 'frame'> {
  readonly drill: Drill<DrillCore>;
  /** The session's done / total: the counter and the progress bar. */
  readonly progress: NonNullable<FrameParts['progress']>;
  /** What the session did, for the Done summary. */
  readonly counts: SessionCounts;
  /** The live line's status, in the mode's words. */
  readonly status: { readonly key: StatusKey; readonly text: string };
  /** Said between the side to move and the status: a review's reply. */
  readonly said?: ReactNode;
  /** Beside the move field's Type button: a review's Hint. */
  readonly tools?: ReactNode;
  /** The line so far, from its root. */
  readonly line: {
    readonly moves: readonly RepertoireMove[];
    readonly rootKey: string | undefined;
  };
}

/**
 * The live line: the side to move, what is said, the status, and an
 * unknown typed move, heard as each comes.
 */
function Status({
  drill,
  said,
  status,
}: Pick<DrillShellProps, 'drill' | 'said' | 'status'>): JSX.Element {
  const t = useTranslations('board.moveInput');
  return (
    <div aria-live="polite" className="flex flex-col gap-1">
      <ToMove color={drill.toMove} />
      {said}
      <StatusLine tone={TONES[status.key]} text={status.text} />
      {drill.state.unknownTyped ? (
        <p className="text-error">{t('unknown')}</p>
      ) : null}
    </div>
  );
}

/**
 * The live panel. While a coach note or the two-answers notice holds the
 * drill only it and Next count: the move field and its tools cannot be
 * used, and on a portrait tablet they would push the note out of the panel.
 */
function LivePanel(props: DrillShellProps): JSX.Element {
  const { drill, line } = props;
  return (
    <>
      <Status drill={drill} said={props.said} status={props.status} />
      {drill.next === null ? (
        <MoveRow input={drill} color={drill.toMove}>
          {props.tools}
        </MoveRow>
      ) : null}
      <DrillCoachNote notes={drill.notes} />
      <TwoAnswersNotice answers={drill.answers} />
      <LineSoFar moves={line.moves} rootKey={line.rootKey} />
    </>
  );
}

/** A drill's screen: live until its session is over, then its Done summary. */
export function DrillShell(props: DrillShellProps): JSX.Element {
  const { drill, links, frame, progress } = props;
  const t = useTranslations();
  const describe = useSquareWords(drill.view.fen);
  const board = (
    <Board
      view={drill.view}
      label={t('board.label')}
      describe={describe}
      onMove={drill.onMove}
    />
  );
  if (drill.done !== null)
    // Done names no item: it has no context line (training-screen.md).
    return frame({
      progress,
      board,
      finished: true,
      panel: (
        <DoneSummary
          counts={props.counts}
          progress={drill.progress()}
          standing={drill.standing()}
        />
      ),
      actions: (
        <DoneActions
          offer={drill.done}
          links={links}
          onContinue={drill.restart}
        />
      ),
    });
  return frame({
    item: drill.item,
    progress,
    board,
    panel: <LivePanel {...props} />,
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
