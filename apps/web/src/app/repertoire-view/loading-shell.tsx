import { useTranslations } from 'next-intl';
import type { JSX } from 'react';
import { SlowStatus } from '../slow-status';
import { RepertoireFrame, type PanelBasis } from './repertoire-frame';

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
    <div className="flex min-h-touch items-center gap-2">
      <div className="size-6 rounded-control bg-sunken" />
      <div className={`${SKELETON_LINE} w-48`} />
    </div>
  );
}

/**
 * A repertoire screen while it loads (docs/design/repertoire-screen.md,
 * States), in the page's own frame: the top bar's skeleton, the real board
 * frame without pieces, a skeleton line in the board row and skeleton
 * lines for the chapter line and the move list in the scroller; after
 * about a second, one "Loading" line in the status line. Shared by the
 * owner's page, the assigned page and the coach's read-only view.
 */
export function RepertoireLoadingShell({
  panelBasis,
}: {
  /** The page's panel basis (RepertoireFrame), so the board does not jump when it arrives. */
  readonly panelBasis?: PanelBasis;
} = {}): JSX.Element {
  const t = useTranslations('repertoires');
  return (
    <RepertoireFrame
      busy
      panelBasis={panelBasis}
      topBar={<TopBarSkeleton />}
      board={
        <div
          aria-hidden="true"
          style={EMPTY_BOARD}
          className="aspect-square lg:rounded-board"
        />
      }
      boardRow={<div className={`${SKELETON_LINE} w-40`} />}
      status={<SlowStatus text={t('loading')} />}
      scroller={
        <>
          <div className={`${SKELETON_LINE} w-full`} />
          <div className={`${SKELETON_LINE} w-3/4`} />
          <div className={`${SKELETON_LINE} w-full`} />
        </>
      }
    />
  );
}
