'use client';

import type { JSX, ReactNode } from 'react';
import type { ChapterNames } from '../../lib/chapter-label';
import { Board, type BoardProps } from '../board/board';
import { BoardRow } from './board-row';
import { Announcer, useBoardWords } from './board-words';
import { RepertoirePanel, type PanelContent } from './repertoire-panel';
import type { ScreenState } from './screen-state';
import { ScreenStatus } from './screen-status';
import type { RepertoireView } from './view';

/** The builder's drawing on the board, and what it last said. */
type Drawing = Required<
  Pick<BoardProps, 'onSquare' | 'onShapes' | 'onEscape'>
> & { readonly said: string };

interface RepertoireShellProps {
  /** The top bar: the way back and the repertoire's name. */
  readonly header: ReactNode;
  /** The repertoire's name, which the board's accessible name carries. */
  readonly name: string;
  /** What titles the chapters (decision 17, R-158). */
  readonly names: ChapterNames;
  readonly view: RepertoireView;
  /** What the view puts in the panel under the board row. */
  readonly panel: PanelContent;
  /** Builder mode: drawing marks on the board. */
  readonly drawing?: Drawing;
  /** A row under the board row (the builder's), outside the scrolling panel. */
  readonly toolbar?: ReactNode;
  /** Reloads the page once the repertoire changed elsewhere (a view that edits). */
  readonly onReload?: () => void;
}

/**
 * The page's status line, under the board row and the builder row and
 * outside the scrolling panel, so a refusal is seen however far the panel
 * has scrolled.
 */
function PanelStatus({
  state,
  onReload,
}: {
  readonly state: ScreenState;
  readonly onReload: () => void;
}): JSX.Element {
  return (
    <div className="shrink-0 px-gutter lg:px-0">
      <ScreenStatus
        message={state.message}
        stale={state.stale}
        onReload={onReload}
      />
    </div>
  );
}

/** A view that never edits is never stale, so has nothing to reload. */
const noReload = (): void => undefined;

/**
 * A repertoire page (docs/design/repertoire-screen.md, section 2): on a
 * phone the top bar, board, board row and toolbar stay put and the panel
 * scrolls below; on a desktop the board and the panel sit side by side.
 */
export function RepertoireShell({
  header,
  name,
  names,
  view,
  panel,
  drawing,
  toolbar,
  onReload = noReload,
}: RepertoireShellProps): JSX.Element {
  const { state, dispatch, board, play } = view;
  const { said, ...handlers }: Partial<Drawing> = drawing ?? {};
  const words = useBoardWords(name, state, board.view.fen, names);
  return (
    <main className="flex h-dvh flex-col lg:mx-auto lg:h-auto lg:max-w-6xl lg:gap-6 lg:px-gutter-wide lg:py-8">
      {header}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row lg:items-start lg:justify-center lg:gap-8">
        <div className="shrink-0 lg:w-[min(calc(100dvh-12rem),42rem)]">
          <Board
            view={board.view}
            label={words.label}
            describe={words.describe}
            onMove={play.onMove}
            {...handlers}
          />
        </div>
        <div className="flex min-h-0 flex-1 flex-col lg:max-h-[calc(100dvh-12rem)] lg:w-panel lg:flex-none lg:rounded-card lg:bg-surface lg:p-4 lg:shadow-card">
          <BoardRow
            state={state}
            dispatch={dispatch}
            board={board}
            play={play}
          />
          {toolbar}
          <PanelStatus state={state} onReload={onReload} />
          <RepertoirePanel view={view} names={names} content={panel} />
        </div>
      </div>
      <Announcer state={state} />
      {said === undefined ? null : (
        <p aria-live="polite" className="sr-only">
          {said}
        </p>
      )}
    </main>
  );
}
