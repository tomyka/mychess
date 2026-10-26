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
  // A quiet, neutral note rather than an error: nothing is lost or blocked,
  // the queue keeps trying. The clock icon and the words carry it, not colour.
  return (
    <div
      className={
        waiting
          ? 'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-control border border-border bg-sunken px-3 py-2 text-fg'
          : 'sr-only'
      }
    >
      {waiting ? (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="size-5 shrink-0 text-fg-muted"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l3 2" />
        </svg>
      ) : null}
      <p role="status" className="min-w-0 flex-1 text-sm">
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
