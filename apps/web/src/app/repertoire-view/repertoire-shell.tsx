'use client';

import type { JSX, ReactNode } from 'react';
import type { ChapterNames } from '../../lib/chapter-label';
import { Board, type BoardProps } from '../board/board';
import { BoardRow } from './board-row';
import { Announcer, useBoardWords } from './board-words';
import { BrowseCommentStrip } from './comment-strip';
import {
  BOARD_CELL,
  PANEL_CELL,
  PanelCard,
  REPERTOIRE_GRID,
  TOP_BAR_CELL,
} from './repertoire-layout';
import { RepertoirePanel, type PanelContent } from './repertoire-panel';
import type { ScreenMessage, ScreenState } from './screen-state';
import { ScreenStatus } from './screen-status';
import type { RepertoireView } from './view';

/** The builder's drawing on the board, and what it last said. */
type Drawing = Required<
  Pick<BoardProps, 'onSquare' | 'onShapes' | 'onEscape'>
> & { readonly said: string };

interface RepertoireShellProps {
  /** The repertoire's header (RepertoireTopBar): over the board on a phone, first in the panel on a desktop. */
  readonly topBar: ReactNode;
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
  /** What the view offers beside a status message (null: nothing). */
  readonly statusAction?: StatusAction;
}

type StatusAction = (message: ScreenMessage) => ReactNode;

/**
 * The page's status line, under the board row and the builder row and
 * outside the scrolling panel, so a refusal is seen however far the panel
 * has scrolled.
 */
function PanelStatus({
  state,
  onReload,
  statusAction,
}: {
  readonly state: ScreenState;
  readonly onReload: () => void;
  readonly statusAction: StatusAction;
}): JSX.Element {
  const { message } = state;
  return (
    <div className="shrink-0 px-gutter lg:mb-3 lg:px-0">
      <ScreenStatus
        message={message}
        stale={state.stale}
        onReload={onReload}
        action={message === null ? null : statusAction(message)}
      />
    </div>
  );
}

/** A view that never edits is never stale, so has nothing to reload. */
const noReload = (): void => undefined;

const noAction: StatusAction = () => null;

/**
 * A repertoire page (docs/design/repertoire-screen.md, section 2): on a
 * phone the top bar, board, board row, toolbar and comment strip stay put
 * and the panel scrolls below; on a desktop the board sits beside one card
 * that holds the top bar, then the panel (repertoire-layout.tsx). The top
 * bar is rendered once, so the page has one h1 and one Edit switch.
 */
export function RepertoireShell({
  topBar,
  name,
  names,
  view,
  panel,
  drawing,
  toolbar,
  onReload = noReload,
  statusAction = noAction,
}: RepertoireShellProps): JSX.Element {
  const { state, dispatch, board, play } = view;
  const { said, ...handlers }: Partial<Drawing> = drawing ?? {};
  const words = useBoardWords(name, state, board.view.fen, names);
  return (
    <main className={REPERTOIRE_GRID}>
      <PanelCard />
      <div className={`shrink-0 ${TOP_BAR_CELL}`}>{topBar}</div>
      {/* On a desktop the panel scrolls with the page, not inside a box
          (#331); the board stays in view beside it. */}
      <div className={`shrink-0 lg:sticky ${BOARD_CELL}`}>
        <Board
          view={board.view}
          label={words.label}
          describe={words.describe}
          onMove={play.onMove}
          {...handlers}
        />
      </div>
      <div className={`flex min-h-0 flex-1 flex-col ${PANEL_CELL}`}>
        <BoardRow state={state} dispatch={dispatch} board={board} play={play} />
        {toolbar}
        <PanelStatus
          state={state}
          onReload={onReload}
          statusAction={statusAction}
        />
        <BrowseCommentStrip state={state} label={panel.commentLabel} />
        <RepertoirePanel view={view} names={names} content={panel} />
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
