'use client';

import { useTranslations } from 'next-intl';
import type { JSX } from 'react';
import { SECONDARY_BUTTON } from '../buttons';

/**
 * R-60: results not saved yet. The drill goes on while the queue retries in
 * the background; the banner says how many wait and lets the player try at
 * once. The status line is always there, empty while all is saved, so a
 * screen reader hears it when results start to wait.
 */
export function SyncBanner({
  unsynced,
  onRetry,
}: {
  readonly unsynced: number;
  readonly onRetry: () => void;
}): JSX.Element {
  const t = useTranslations('training.sync');
  const waiting = unsynced > 0;
  return (
    <div
      className={
        waiting
          ? 'flex flex-wrap items-center gap-3 rounded-control bg-error-subtle px-4 py-3 text-fg'
          : 'sr-only'
      }
    >
      <p role="status" className="min-w-0 flex-1">
        {waiting ? t('unsynced', { count: unsynced }) : ''}
      </p>
      {waiting ? (
        <button type="button" onClick={onRetry} className={SECONDARY_BUTTON}>
          {t('retry')}
        </button>
      ) : null}
    </div>
  );
}
