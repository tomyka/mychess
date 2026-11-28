'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';
import { ROUTES } from '../lib/routes';
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from './buttons';
import { EntryFrame } from './entry-frame';

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
  const t = useTranslations();
  return (
    <EntryFrame>
      <h1 className="text-2xl font-bold sm:text-3xl">{t('error.title')}</h1>
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={reset} className={PRIMARY_BUTTON}>
          {t('error.retry')}
        </button>
        <Link href={ROUTES.home} className={SECONDARY_BUTTON}>
          {t('nav.goToday')}
        </Link>
      </div>
    </EntryFrame>
  );
}
