import { useTranslations } from 'next-intl';
import type { JSX, ReactNode } from 'react';
import { SlowStatus } from '../../slow-status';

/** A skeleton line: one line of text not there yet. */
export const SKELETON_LINE = 'h-5 rounded-control bg-sunken';

/** The board's squares from the board tokens, a8 light: no pieces, not focusable. */
const BOARD_FRAME = {
  backgroundImage:
    'repeating-conic-gradient(var(--color-board-dark) 0 25%, var(--color-board-light) 0 50%)',
  backgroundSize: '25% 25%',
};

/**
 * A repertoire screen while it loads (docs/design/repertoire-screen.md,
 * States): `header`'s skeleton, the real board frame without pieces and
 * skeleton lines for the chapter row, the comment and the move list; after
 * about a second, one "Loading" line. Shared by the owner's page and the
 * coach's read-only view, which differ only in their header.
 */
export function RepertoireLoadingShell({
  header,
}: {
  readonly header: ReactNode;
}): JSX.Element {
  const t = useTranslations('repertoires');
  return (
    <main
      aria-busy="true"
      className="flex h-dvh flex-col lg:mx-auto lg:h-auto lg:max-w-6xl lg:gap-6 lg:px-gutter-wide lg:py-8"
    >
      {header}
      <div className="flex flex-col lg:flex-row lg:justify-center lg:gap-8">
        <div
          aria-hidden="true"
          style={BOARD_FRAME}
          className="aspect-square w-full lg:w-[min(calc(100dvh-12rem),42rem)] lg:rounded-board"
        />
        <div className="flex flex-col gap-3 px-gutter py-3 lg:w-panel lg:px-0">
          <div className={`${SKELETON_LINE} w-40`} />
          <div className={`${SKELETON_LINE} w-full`} />
          <div className={`${SKELETON_LINE} w-3/4`} />
          <div className={`${SKELETON_LINE} w-full`} />
          <SlowStatus text={t('loading')} />
        </div>
      </div>
    </main>
  );
}
