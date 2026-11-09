// The training screen's layout classes (docs/design/training-screen.md),
// shared by the frame and the loading page. Not in the frame's 'use client'
// module: a server component (loading.tsx) that imports a value from one
// gets a client reference, not the string.
//
// One tree in the order the eye reads it, so Tab follows the screen: the top
// bar, the board, the panel, the bottom bar. On a phone they stack and only
// the panel scrolls. On a desktop a grid puts the board in the left column
// and the rest in the right one, over a card drawn behind them (FRAME_CARD),
// as tall as the board.

/** The board's edge on a desktop (FRAME_MAIN's --board-edge). */
const BOARD_EDGE = 'lg:w-(--board-edge)';

/**
 * On a desktop the board's edge is the largest square that fits (the
 * design's min(height, width - panel - gutters)): the height less the
 * padding (py-8), 680px at most, and the width less the panel, the gap and
 * the side padding (2rem each), so a 1024px-wide portrait tablet does not
 * overflow (#323). The grid is as tall as the board plus its padding, so
 * the card is the board's height.
 */
export const FRAME_MAIN =
  'flex h-dvh flex-col lg:mx-auto lg:grid lg:[--board-edge:min(calc(100dvh_-_4rem),42.5rem,calc(100vw_-_var(--spacing-panel)_-_6rem))] lg:h-[calc(var(--board-edge)+4rem)] lg:max-w-6xl lg:grid-cols-[auto_var(--spacing-panel)] lg:grid-rows-[auto_minmax(0,1fr)_auto] lg:justify-center lg:gap-x-8 lg:gap-y-3 lg:px-gutter-wide lg:py-8';

/** The desktop side card, drawn behind the right column's parts. */
export const FRAME_CARD =
  'hidden lg:col-start-2 lg:row-span-full lg:block lg:w-panel lg:rounded-card lg:bg-surface lg:shadow-card';

/** The top bar and the session progress under it. */
export const FRAME_HEAD =
  'flex flex-col lg:col-start-2 lg:row-start-1 lg:mx-4 lg:mt-4 lg:min-w-0 lg:gap-3';

/** Between 640 and 1024px the board is capped at the viewport's height. */
export const FRAME_BOARD = `shrink-0 sm:mx-auto sm:w-[min(100%,calc(100dvh-3.75rem))] lg:col-start-1 lg:row-span-full lg:mx-0 lg:self-start ${BOARD_EDGE}`;

export const FRAME_TOP =
  'flex min-h-14 items-center gap-3 px-gutter lg:min-h-0 lg:flex-col lg:items-start lg:gap-1 lg:px-0';

/** With no bottom bar, its margin and the empty row's gap make the card's padding. */
export const FRAME_PANEL =
  'flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-gutter py-3 lg:col-start-2 lg:row-start-2 lg:mx-4 lg:mb-1 lg:min-w-0 lg:px-0 lg:py-0';

export const FRAME_ACTIONS =
  'flex flex-wrap gap-3 border-t border-border px-gutter pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] lg:col-start-2 lg:row-start-3 lg:mx-4 lg:mb-4 lg:border-0 lg:px-0 lg:pt-0 lg:pb-0';
