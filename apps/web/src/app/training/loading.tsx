import { useTranslations } from 'next-intl';
import type { JSX } from 'react';
import { EMPTY_BOARD, SKELETON_LINE } from '../repertoire-view';
import { SlowStatus } from '../slow-status';
import {
  FRAME_BOARD,
  FRAME_CARD,
  FRAME_HEAD,
  FRAME_MAIN,
  FRAME_PANEL,
  FRAME_TITLE,
  FRAME_TOP,
  FRAME_TRACK,
} from './frame-classes';

// The training page while it loads (docs/design/training-screen.md,
// Loading): the frame with the real board's squares and no pieces, so
// nothing shifts when the position arrives, and skeleton lines; no spinner.
// After about a second one "loading" line.
export default function TrainingLoading(): JSX.Element {
  const t = useTranslations('training');
  return (
    <main aria-busy="true" className={FRAME_MAIN}>
      <div aria-hidden="true" className={FRAME_CARD} />
      {/* The drill's header in its geometry: the back button's square, the
          title and context lines at their line heights, the counter, and
          Today's track, so the board does not move when the drill comes. */}
      <div className={FRAME_HEAD}>
        <div className={FRAME_TOP}>
          <div className="-ml-2 flex size-touch shrink-0 items-center justify-center">
            <div className={`${SKELETON_LINE} w-6`} />
          </div>
          <div className={FRAME_TITLE}>
            <div className="flex h-7 items-center">
              <div className={`${SKELETON_LINE} w-40`} />
            </div>
            <div className={`${SKELETON_LINE} w-56 max-w-full`} />
          </div>
          <div className={`${SKELETON_LINE} w-12`} />
        </div>
        <div className={FRAME_TRACK} />
      </div>
      <div
        aria-hidden="true"
        style={EMPTY_BOARD}
        className={`${FRAME_BOARD} aspect-square w-full lg:rounded-board`}
      />
      <div className={FRAME_PANEL}>
        <SlowStatus text={t('loading')} />
        <div className={`${SKELETON_LINE} w-48`} />
        <div className={`${SKELETON_LINE} w-32`} />
      </div>
    </main>
  );
}
