'use client';

import type { JSX, ReactNode } from 'react';
import type { ChapterNames } from '../../lib/chapter-label';
import { Board, type BoardProps } from '../board/board';
import { BoardRow } from './board-row';
import { Announcer, useBoardWords } from './board-words';
import { BrowseCommentStrip } from './comment-strip';
import { RepertoireFrame, type PanelBasis } from './repertoire-frame';
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
  /**
   * What sits under the comment strip, in its slot between the board row
   * and the scroller (the coach's own note on the move); none by default.
   */
  readonly underComment?: ReactNode;
  /** The panel cell's basis on a phone (RepertoireFrame); `standard` by default. */
  readonly panelBasis?: PanelBasis | undefined;
  /** What the view offers beside a status message (null: nothing). */
  readonly statusAction?: StatusAction;
}

type StatusAction = (message: ScreenMessage) => ReactNode;

/** The page's status line, with what the view offers beside a message. */
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
    <ScreenStatus
      message={message}
      stale={state.stale}
      onReload={onReload}
      action={message === null ? null : statusAction(message)}
    />
  );
}

/** A view that never edits is never stale, so has nothing to reload. */
const noReload = (): void => undefined;

const noAction: StatusAction = () => null;

/**
 * A repertoire page (docs/design/repertoire-screen.md, section 2): on a
 * phone the top bar, board, board row, toolbar and comment strip stay put
 * and the panel scrolls below; on a desktop the board sits beside one card
 * that holds the top bar, then the panel (repertoire-frame.tsx). The top
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
  underComment = null,
  panelBasis,
}: RepertoireShellProps): JSX.Element {
  const { state, dispatch, board, play } = view;
  const { said, ...handlers }: Partial<Drawing> = drawing ?? {};
  const words = useBoardWords(name, state, board.view.fen, names);
  return (
    <RepertoireFrame
      topBar={topBar}
      board={
        <Board
          view={board.view}
          label={words.label}
          describe={words.describe}
          onMove={play.onMove}
          {...handlers}
        />
      }
      boardRow={
        <BoardRow state={state} dispatch={dispatch} board={board} play={play} />
      }
      builderRow={toolbar}
      status={
        <PanelStatus
          state={state}
          onReload={onReload}
          statusAction={statusAction}
        />
      }
      comment={
        <>
          <BrowseCommentStrip state={state} label={panel.comment?.label} />
          {underComment}
        </>
      }
      panelBasis={panelBasis}
      scroller={<RepertoirePanel view={view} names={names} content={panel} />}
    >
      <Announcer state={state} />
      {said === undefined ? null : (
        <p aria-live="polite" className="sr-only">
          {said}
        </p>
      )}
    </RepertoireFrame>
  );
}
