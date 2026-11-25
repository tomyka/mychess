'use client';

import { START_KEY, type Side } from '@mychess/chess';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { JSX, ReactNode } from 'react';
import { Board } from '../board/board';
import type { BoardView } from '../board/board-config';
import { BACK_BUTTON } from '../buttons';
import { BACK_ICON, Icon } from '../line-icon';
import type { FrameParts } from './drill';
import {
  FRAME_ACTIONS,
  FRAME_BOARD,
  FRAME_CARD,
  FRAME_HEAD,
  FRAME_MAIN,
  FRAME_PANEL,
  FRAME_TITLE,
  FRAME_TOP,
  FRAME_TRACK,
} from './frame-classes';
import type { HeaderContext } from './session-header';

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
    <Link href={href} aria-label={label} className={BACK_BUTTON}>
      <Icon path={BACK_ICON} className="size-6" />
    </Link>
  );
}

/** Today's track (FRAME_TRACK), filled to the session's share done. */
function ProgressBar({
  done,
  total,
}: {
  readonly done: number;
  readonly total: number;
}): JSX.Element {
  const share = total === 0 ? 0 : Math.min(1, done / total);
  return (
    <div aria-hidden="true" className={FRAME_TRACK}>
      <div
        className="h-full rounded-pill bg-accent"
        style={{ width: `${String(share * 100)}%` }}
      />
    </div>
  );
}

/**
 * The item under the title (R-224): read whole, once, by a screen reader;
 * shown in parts on one line, the name and the chapter each cut short and
 * the side never, so all three stay in view.
 */
function ContextLine({
  context,
}: {
  readonly context: HeaderContext;
}): JSX.Element {
  const t = useTranslations('training.context');
  const { name, side, chapter } = context;
  return (
    <>
      <p className="sr-only">{context.text}</p>
      <div
        aria-hidden="true"
        className="flex min-w-0 gap-1 text-sm whitespace-nowrap text-fg-muted"
      >
        {name === null ? null : <span className="truncate">{name}</span>}
        <span className="shrink-0">{side}</span>
        {chapter === null ? null : (
          <>
            <span className="shrink-0">{t('separator')}</span>
            <span className="truncate">{chapter}</span>
          </>
        )}
      </div>
    </>
  );
}

interface TopBarProps {
  readonly backHref: string;
  readonly title: string;
  readonly context: HeaderContext | null;
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
        <div className={FRAME_TITLE}>
          <h1 className="truncate text-lg font-semibold lg:text-xl">{title}</h1>
          {context === null ? null : <ContextLine context={context} />}
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
  readonly context: HeaderContext | null;
  /** The side the still board is seen from. */
  readonly side: Side;
  /** The sync banner, at the top of the panel (R-60). */
  readonly banner: ReactNode;
}

/**
 * On a phone, an empty state's board as a strip of its bottom two ranks
 * (the player's own back ranks, the side it is seen from): the board inside
 * stays square, does not shrink, and is pushed to the strip's bottom, its
 * top clipped, not squashed.
 */
const STRIP =
  'max-lg:aspect-[4/1] max-lg:overflow-hidden max-lg:flex max-lg:flex-col max-lg:justify-end max-lg:*:shrink-0';

/**
 * Is the board only shown, not played on? Then it is dimmed; on a phone the
 * done summary hides it, and an empty state crops it to a strip so its card
 * is in view.
 */
const boardClass = (live: boolean, finished: boolean): string => {
  if (live) return FRAME_BOARD;
  const still = finished ? 'max-lg:hidden' : STRIP;
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
