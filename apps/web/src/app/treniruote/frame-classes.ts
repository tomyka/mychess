// The training screen's layout classes (docs/design/training-screen.md),
// shared by the frame and the loading page. Not in the frame's 'use client'
// module: a server component (loading.tsx) that imports a value from one
// gets a client reference, not the string.
//
// On a phone the top bar, board, panel and bottom bar stack, and only the
// panel scrolls; on a desktop the board sits left and the side card right
// holds the top bar, the panel and the bottom bar. The side card is
// `display: contents` on a phone, so its parts take their places in the
// stack by `order`.

/** The board's edge on a desktop: the largest square that fits. */
const BOARD_EDGE = 'lg:w-[min(calc(100dvh-4rem),42.5rem)]';

export const FRAME_MAIN =
  'flex h-dvh flex-col lg:mx-auto lg:h-auto lg:max-w-6xl lg:flex-row lg:items-start lg:justify-center lg:gap-8 lg:px-gutter-wide lg:py-8';

/** Between 640 and 1024px the board is capped at the viewport's height. */
export const FRAME_BOARD = `order-2 shrink-0 sm:mx-auto sm:w-[min(100%,calc(100dvh-3.75rem))] lg:order-1 lg:mx-0 ${BOARD_EDGE}`;

export const FRAME_SIDE =
  'contents lg:order-2 lg:flex lg:h-[min(calc(100dvh-4rem),42.5rem)] lg:w-panel lg:flex-col lg:gap-3 lg:rounded-card lg:bg-surface lg:p-4 lg:shadow-card';

export const FRAME_TOP =
  'order-1 flex min-h-14 items-center gap-3 px-gutter lg:min-h-0 lg:flex-col lg:items-start lg:gap-1 lg:px-0';

export const FRAME_PANEL =
  'order-3 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-gutter py-3 lg:px-0 lg:py-0';
