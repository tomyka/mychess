'use client';

import { START_KEY, type Side } from '@mychess/chess';
import { useTranslations } from 'next-intl';
import type { JSX, ReactNode } from 'react';
import type { TrainingMode } from '../../lib/routes';
import { Board } from '../board/board';
import type { BoardView } from '../board/board-config';
import { BackLink } from '../repertoire-view';
import type { FrameParts } from './drill';
import {
  FRAME_BOARD,
  FRAME_MAIN,
  FRAME_PANEL,
  FRAME_SIDE,
  FRAME_TOP,
} from './frame-classes';

/** The start position, for a screen with nothing to drill. */
const stillView = (side: Side): BoardView => ({
  fen: START_KEY,
  orientation: side,
  turnColor: 'white',
  check: false,
  lastMove: [],
  dests: new Map(),
  shapes: [],
  autoShapes: [],
  drawing: false,
  picking: false,
  picked: null,
  revision: 0,
});

const silent = (): string => '';
const ignore = (): void => undefined;

/** A board that only shows a position: dimmed, not focusable, not announced. */
function StillBoard({ side }: { readonly side: Side }): JSX.Element {
  const t = useTranslations('board');
  return (
    <Board
      view={stillView(side)}
      label={t('label')}
      describe={silent}
      onMove={ignore}
    />
  );
}

function ProgressBar({
  done,
  total,
}: {
  readonly done: number;
  readonly total: number;
}): JSX.Element {
  const share = total === 0 ? 0 : Math.min(1, done / total);
  return (
    <div aria-hidden="true" className="order-1 h-1 bg-sunken lg:rounded-pill">
      <div
        className="h-full bg-accent lg:rounded-pill"
        style={{ width: `${String(share * 100)}%` }}
      />
    </div>
  );
}

interface TopBarProps {
  readonly mode: TrainingMode;
  readonly backHref: string;
  readonly title: string;
  readonly progress: FrameParts['progress'];
}

function TopBar({ mode, backHref, title, progress }: TopBarProps): JSX.Element {
  const t = useTranslations('training');
  return (
    <>
      <header className={FRAME_TOP}>
        <BackLink href={backHref} label={t('back')} />
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold lg:w-full lg:flex-none lg:text-xl">
          {title}
        </h1>
        {progress === undefined ? null : (
          <p className="shrink-0 text-fg-muted tabular-nums">
            <span className="max-lg:sr-only">{t(`mode.${mode}`)} </span>
            {t('counter', progress)}
          </p>
        )}
      </header>
      {progress === undefined ? null : <ProgressBar {...progress} />}
    </>
  );
}

export interface TrainingFrameProps extends FrameParts {
  readonly mode: TrainingMode;
  readonly backHref: string;
  /** The title when the drill gives none. */
  readonly defaultTitle: string;
  /** The side the still board is seen from. */
  readonly side: Side;
  /** The sync banner, at the top of the panel (R-60). */
  readonly banner: ReactNode;
}

/** Is the board only shown, not played on? */
const boardClass = (live: boolean, finished: boolean): string => {
  if (live) return FRAME_BOARD;
  return `${FRAME_BOARD} opacity-60 ${finished ? 'max-lg:hidden' : ''}`;
};

/** The training screen's frame; nothing in it overlays the board. */
export function TrainingFrame(props: TrainingFrameProps): JSX.Element {
  const { board, finished = false } = props;
  const live = board !== undefined && !finished;
  return (
    <main className={FRAME_MAIN}>
      <div className={boardClass(live, finished)} inert={!live}>
        {board ?? <StillBoard side={props.side} />}
      </div>
      <div className={FRAME_SIDE}>
        <TopBar
          mode={props.mode}
          backHref={props.backHref}
          title={props.title ?? props.defaultTitle}
          progress={props.progress}
        />
        <div className={FRAME_PANEL}>
          {props.banner}
          {props.panel}
        </div>
        {props.actions === undefined ? null : (
          <div className="order-4 flex flex-wrap gap-3 border-t border-border px-gutter pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] lg:border-0 lg:px-0 lg:pb-0">
            {props.actions}
          </div>
        )}
      </div>
    </main>
  );
}
