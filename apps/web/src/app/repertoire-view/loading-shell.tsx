import { useTranslations } from 'next-intl';
import type { JSX } from 'react';
import { SlowStatus } from '../slow-status';
import {
  BOARD_CELL,
  BOARD_SQUARE,
  PANEL_CELL,
  PanelCard,
  REPERTOIRE_GRID,
  TOP_BAR_CELL,
} from './repertoire-layout';

/** A skeleton line: one line of text not there yet. */
export const SKELETON_LINE = 'h-5 rounded-control bg-sunken';

/** The board's squares from the board tokens, a8 light: no pieces, not focusable. */
export const EMPTY_BOARD = {
  backgroundImage:
    'repeating-conic-gradient(var(--color-board-dark) 0 25%, var(--color-board-light) 0 50%)',
  backgroundSize: '25% 25%',
};

/** The top bar's shape (RepertoireTopBar): back and the name, one row. */
function TopBarSkeleton(): JSX.Element {
  return (
    <div className="flex min-h-touch items-center gap-2 px-gutter py-1 lg:p-0">
      <div className="size-6 rounded-control bg-sunken" />
      <div className={`${SKELETON_LINE} w-48`} />
    </div>
  );
}

/**
 * A repertoire screen while it loads (docs/design/repertoire-screen.md,
 * States), in the page's own layout: the top bar's skeleton, the real
 * board frame without pieces and skeleton lines for the chapter row, the
 * comment and the move list; after about a second, one "Loading" line.
 * Shared by the owner's page and the coach's read-only view.
 */
export function RepertoireLoadingShell(): JSX.Element {
  const t = useTranslations('repertoires');
  return (
    <main aria-busy="true" className={REPERTOIRE_GRID}>
      <PanelCard />
      <div className={TOP_BAR_CELL}>
        <TopBarSkeleton />
      </div>
      <div className={BOARD_CELL}>
        <div
          aria-hidden="true"
          style={EMPTY_BOARD}
          className={`aspect-square lg:rounded-board ${BOARD_SQUARE}`}
        />
      </div>
      <div className={`gap-3 px-gutter py-3 ${PANEL_CELL}`}>
        <div className={`${SKELETON_LINE} w-40`} />
        <div className={`${SKELETON_LINE} w-full`} />
        <div className={`${SKELETON_LINE} w-3/4`} />
        <div className={`${SKELETON_LINE} w-full`} />
        <SlowStatus text={t('loading')} />
      </div>
    </main>
  );
}
