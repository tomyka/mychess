'use client';

import { START_KEY, type Side } from '@mychess/chess';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { JSX, ReactNode } from 'react';
import { Board } from '../board/board';
import type { BoardView } from '../board/board-config';
import type { FrameParts } from './drill';
import {
  FRAME_ACTIONS,
  FRAME_BOARD,
  FRAME_CARD,
  FRAME_HEAD,
  FRAME_MAIN,
  FRAME_PANEL,
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

/** The way back: an icon button at every width, as in the shell. */
function BackButton({
  href,
  label,
}: {
  readonly href: string;
  readonly label: string;
}): JSX.Element {
  return (
    <Link
      href={href}
      aria-label={label}
      className="inline-flex min-h-touch min-w-touch shrink-0 items-center justify-center rounded-control text-accent hover:bg-accent-subtle"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="size-6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M15 6l-6 6 6 6" />
      </svg>
    </Link>
  );
}

/** Today's track: 6px, rounded, with gutters on a phone. */
function ProgressBar({
  done,
  total,
}: {
  readonly done: number;
  readonly total: number;
}): JSX.Element {
  const share = total === 0 ? 0 : Math.min(1, done / total);
  return (
    <div
      aria-hidden="true"
      className="mx-gutter h-1.5 overflow-hidden rounded-pill bg-border lg:mx-0"
    >
      <div
        className="h-full rounded-pill bg-accent"
        style={{ width: `${String(share * 100)}%` }}
      />
    </div>
  );
}

interface TopBarProps {
  readonly backHref: string;
  readonly title: string;
  readonly context: string | null;
  readonly progress: FrameParts['progress'];
}

/** Back, the session's name with the item under it (R-224), the counter (R-223). */
function TopBar({
  backHref,
  title,
  context,
  progress,
}: TopBarProps): JSX.Element {
  const t = useTranslations('training');
  return (
    <div className={FRAME_HEAD}>
      <header className={FRAME_TOP}>
        <BackButton href={backHref} label={t('back')} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold lg:text-xl">{title}</h1>
          {context === null ? null : (
            <p className="truncate text-sm text-fg-muted">{context}</p>
          )}
        </div>
        {progress === undefined ? null : (
          <p className="shrink-0 text-base font-semibold tabular-nums">
            {t('counter', progress)}
          </p>
        )}
      </header>
      {progress === undefined ? null : <ProgressBar {...progress} />}
    </div>
  );
}

export interface TrainingFrameProps extends FrameParts {
  readonly backHref: string;
  /** The session's name (R-224). */
  readonly title: string;
  /** Under the title: the item's repertoire, side and chapter, if any (R-224). */
  readonly context: string | null;
  /** The side the still board is seen from. */
  readonly side: Side;
  /** The sync banner, at the top of the panel (R-60). */
  readonly banner: ReactNode;
}

/**
 * Is the board only shown, not played on? Then it is dimmed; on a phone the
 * done summary hides it, and an empty state crops it to a strip so its card
 * is in view (the board inside stays square and is clipped, not squashed).
 */
const boardClass = (live: boolean, finished: boolean): string => {
  if (live) return FRAME_BOARD;
  const still = finished
    ? 'max-lg:hidden'
    : 'max-lg:aspect-[5/2] max-lg:overflow-hidden';
  return `${FRAME_BOARD} opacity-60 ${still}`;
};

/**
 * The training screen's frame; nothing in it overlays the board. Its parts
 * come in the order they show, so Tab goes back link, board, panel, bottom
 * bar at every width; the board keeps its place in the tree, so focus stays
 * on it after a move.
 */
export function TrainingFrame(props: TrainingFrameProps): JSX.Element {
  const { board, finished = false } = props;
  const live = board !== undefined && !finished;
  return (
    <main className={FRAME_MAIN}>
      <div aria-hidden="true" className={FRAME_CARD} />
      <TopBar
        backHref={props.backHref}
        title={props.title}
        context={props.context}
        progress={props.progress}
      />
      <div className={boardClass(live, finished)} inert={!live}>
        {board ?? <StillBoard side={props.side} />}
      </div>
      <div className={FRAME_PANEL}>
        {props.banner}
        {props.panel}
      </div>
      {props.actions === undefined ? null : (
        <div className={FRAME_ACTIONS}>{props.actions}</div>
      )}
    </main>
  );
}
