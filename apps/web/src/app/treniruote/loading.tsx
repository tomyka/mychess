import { useTranslations } from 'next-intl';
import type { JSX } from 'react';
import { EMPTY_BOARD, SKELETON_LINE } from '../repertoire-view';
import { SlowStatus } from '../slow-status';
import {
  FRAME_BOARD,
  FRAME_MAIN,
  FRAME_PANEL,
  FRAME_SIDE,
  FRAME_TOP,
} from './training-frame';

// The training page while it loads (docs/design/training-screen.md,
// Loading): the frame with the real board's squares and no pieces, so
// nothing shifts when the position arrives, and skeleton lines; no spinner.
// After about a second one "loading" line.
export default function TrainingLoading(): JSX.Element {
  const t = useTranslations('training');
  return (
    <main aria-busy="true" className={FRAME_MAIN}>
      <div
        aria-hidden="true"
        style={EMPTY_BOARD}
        className={`${FRAME_BOARD} aspect-square w-full lg:rounded-board`}
      />
      <div className={FRAME_SIDE}>
        <div className={FRAME_TOP}>
          <div className="flex min-h-touch min-w-touch items-center">
            <div className={`${SKELETON_LINE} w-5`} />
          </div>
          <div className={`${SKELETON_LINE} w-40 flex-1 lg:flex-none`} />
          <div className={`${SKELETON_LINE} w-12`} />
        </div>
        <div className={FRAME_PANEL}>
          <SlowStatus text={t('loading')} />
          <div className={`${SKELETON_LINE} w-48`} />
          <div className={`${SKELETON_LINE} w-32`} />
        </div>
      </div>
    </main>
  );
}
