'use client';

import { useTranslations } from 'next-intl';
import type { JSX } from 'react';
import { PRIMARY_BUTTON } from './buttons';
import { EntryFrame, EntryTitle } from './entry-frame';
import { GoToday } from './go-today';

/**
 * What the error pages show (#381 part 6): that something went wrong, Try
 * again (Next's `reset`) and the way to Today. Nothing of the error itself:
 * its message may hold server detail, and the digest means nothing to a
 * reader. In the entry frame, as the shell may be what failed.
 */
export function ErrorView({
  reset,
}: {
  readonly reset: () => void;
}): JSX.Element {
  const t = useTranslations('error');
  return (
    <EntryFrame>
      <EntryTitle>{t('title')}</EntryTitle>
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={reset} className={PRIMARY_BUTTON}>
          {t('retry')}
        </button>
        <GoToday look="secondary" />
      </div>
    </EntryFrame>
  );
}
