// The repertoire page's layout (spec, Header and Board), shared by the
// page and its loading skeleton so the board does not jump when the page
// arrives. On a phone one column: the top bar, the board, then the panel.
// On a desktop a grid: the board on the left over both rows, and on the
// right the top bar in the first row and the panel in the second, on one
// card, so the header's top is level with the board's.
import type { JSX } from 'react';

/** The page: a fixed-height column on a phone, the two-column grid on a desktop. */
export const REPERTOIRE_GRID =
  'flex h-[calc(100dvh-var(--shell-chrome,0px))] flex-col lg:grid lg:h-auto lg:grid-cols-[auto_var(--spacing-panel)] lg:grid-rows-[auto_1fr] lg:items-start lg:justify-center lg:gap-x-8 lg:px-gutter-wide lg:py-6';

/**
 * The board's cell. On a desktop it spans both rows and is as wide as the
 * viewport is high, less the app bar and the page's padding, at most 46rem:
 * at 1280x800, 800 - 56 - 48 = 696px (finding 7). It is never wider than
 * the viewport less the panel, the gap and the side padding (6rem), so a
 * 1024px-wide screen does not scroll sideways (as the training frame, #323).
 */
export const BOARD_CELL =
  'lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:top-[calc(var(--shell-chrome,0px)+1.5rem)] lg:w-[min(calc(100dvh-3rem-var(--shell-chrome,0px)),46rem,calc(100vw-var(--spacing-panel)-6rem))]';

/** The top bar's cell: on a desktop the card's first row. */
export const TOP_BAR_CELL =
  'lg:col-start-2 lg:row-start-1 lg:px-4 lg:pt-4 lg:pb-3';

/** The panel's cell: on a desktop the card's second row. */
export const PANEL_CELL = 'lg:col-start-2 lg:row-start-2 lg:px-4 lg:pb-4';

/**
 * The desktop card behind the top bar and the panel, one surface for both
 * rows; drawn first, so both paint over it. Nothing on a phone.
 */
export function PanelCard(): JSX.Element {
  return (
    <div
      aria-hidden="true"
      className="hidden lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:block lg:self-stretch lg:rounded-card lg:bg-surface lg:shadow-card"
    />
  );
}
