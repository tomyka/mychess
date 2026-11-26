// The repertoire page's frame (spec, Header and Board): every cell of the
// page's layout, shared by the page and its loading state so the board does
// not jump when the page arrives. On a phone one column: the one-row top
// bar, the board (which gives up height first, so the panel keeps its
// room), then the panel. On a desktop a grid: the board on the left over
// both rows, and on the right the top bar in the first row and the panel in
// the second, on one card, so the header's top is level with the board's.
import type { JSX, ReactNode } from 'react';

/** The page: a fixed-height column on a phone, the two-column grid on a desktop. */
const GRID =
  'flex h-[calc(100dvh-var(--shell-chrome,0px))] flex-col lg:grid lg:h-auto lg:grid-cols-[auto_var(--spacing-panel)] lg:grid-rows-[auto_1fr] lg:items-start lg:justify-center lg:gap-x-8 lg:px-gutter-wide lg:py-6';

/**
 * The desktop card behind the top bar and the panel, one surface for both
 * rows; drawn first, so both paint over it. Nothing on a phone.
 */
const CARD =
  'hidden lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:block lg:self-stretch lg:rounded-card lg:bg-surface lg:shadow-card';

/**
 * The top bar's cell: one row over the board on a phone, in the page's
 * gutter; the card's first row on a desktop.
 */
const TOP_BAR_CELL =
  'shrink-0 px-gutter py-1 lg:col-start-2 lg:row-start-1 lg:px-4 lg:pt-4 lg:pb-3';

/**
 * The board's cell. Below `lg` (spec, Board height) it starts as tall as
 * the screen is wide and gives up height first: it shrinks 100 times
 * faster than the panel, down to 7rem, and is a size container, so the
 * board in it (BOARD_SQUARE) is the largest square that fits, centred.
 * On a desktop it spans both rows, stays in view while the panel scrolls
 * with the page (#331), and is as wide as the viewport is high, less the
 * app bar and the page's padding, at most 46rem: at 1280x800,
 * 800 - 56 - 48 = 696px (finding 7). It is never wider than the viewport
 * less the panel, the gap and the side padding (6rem), so a 1024px-wide
 * screen does not scroll sideways (as the training frame, #323).
 */
const BOARD_CELL =
  'flex min-h-28 shrink-[100] grow-0 basis-[100vw] justify-center [container-type:size] lg:sticky lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:top-[calc(var(--shell-chrome,0px)+1.5rem)] lg:block lg:w-[min(calc(100dvh-3rem-var(--shell-chrome,0px)),46rem,calc(100vw-var(--spacing-panel)-6rem))] lg:basis-auto lg:[container-type:normal]';

/** The board in its cell: the largest square the phone cell holds; the cell's width on a desktop. */
const BOARD_SQUARE = 'w-[min(100cqw,100cqh)] lg:w-full';

/**
 * The panel's cell: the rows under the board and the scroller. Below `lg`
 * it starts at 16.5rem (the board row 60px, a one-line comment 36px, the
 * scroller 168px) and keeps it while the board shrinks; the strip and the
 * rows live here, so stepping through moves never resizes the board. On a
 * desktop the card's second row.
 */
const PANEL_CELL =
  'flex min-h-0 flex-[1_1_16.5rem] flex-col lg:col-start-2 lg:row-start-2 lg:px-4 lg:pb-4';

/** A row under the board: the page's gutter on a phone, the card's on a desktop. */
const ROW = 'shrink-0 px-gutter lg:px-0';

/** The board row: a 44px field with 8px over and under it, 60px. */
const BOARD_ROW = `${ROW} py-2`;

/** The builder row, under the board row; no room when there is none. */
const BUILDER_ROW = `${ROW} pb-2 empty:hidden`;

/** The status line, outside the scroller so a refusal is seen however far it has scrolled. */
const STATUS_ROW = `${ROW} lg:mb-3`;

/** The comment strip, pinned above the scroller; no room when there is none. */
const COMMENT_ROW = 'shrink-0 empty:hidden lg:mb-4';

/**
 * On a phone the scroller; on a desktop a plain column that grows with its
 * content, so the panel scrolls with the page (#331).
 */
const SCROLLER =
  'flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-gutter pt-2 pb-3 lg:flex-none lg:gap-4 lg:overflow-visible lg:p-0';

export interface RepertoireFrameProps {
  /** The header: over the board on a phone, first on the card on a desktop. */
  readonly topBar: ReactNode;
  /** The board, as wide as its square. */
  readonly board: ReactNode;
  /** The typed-move field and the step buttons, first under the board. */
  readonly boardRow: ReactNode;
  /** The builder's row under the board row; null or absent: none. */
  readonly builderRow?: ReactNode;
  /** The page's status line. */
  readonly status: ReactNode;
  /** The comment strip; null or absent: none. */
  readonly comment?: ReactNode;
  /** What scrolls under the rows: the panel's content. */
  readonly scroller: ReactNode;
  /** The page is still loading (aria-busy). */
  readonly busy?: boolean | undefined;
  /** What is outside the cells, after them: the page's live regions. */
  readonly children?: ReactNode;
}

/**
 * The repertoire page's frame: places each cell's content, and owns the
 * phone's height budget and every row's spacing. The DOM order is the
 * visual order at every width, so Tab follows what the eye sees.
 */
export function RepertoireFrame({
  topBar,
  board,
  boardRow,
  builderRow = null,
  status,
  comment = null,
  scroller,
  busy = false,
  children,
}: RepertoireFrameProps): JSX.Element {
  return (
    <main aria-busy={busy ? true : undefined} className={GRID}>
      <div aria-hidden="true" className={CARD} />
      <div className={TOP_BAR_CELL}>{topBar}</div>
      <div className={BOARD_CELL}>
        <div className={BOARD_SQUARE}>{board}</div>
      </div>
      <div className={PANEL_CELL}>
        <div className={BOARD_ROW}>{boardRow}</div>
        <div className={BUILDER_ROW}>{builderRow}</div>
        <div className={STATUS_ROW}>{status}</div>
        <div className={COMMENT_ROW}>{comment}</div>
        <div data-panel-scroller="" className={SCROLLER}>
          {scroller}
        </div>
      </div>
      {children}
    </main>
  );
}
