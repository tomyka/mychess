'use client';

import { useTranslations } from 'next-intl';
import type { JSX } from 'react';
import { SECONDARY_BUTTON } from '../buttons';
import { dismissLichessUnlinkedAction } from './actions';

/**
 * Why Lichess is no longer connected (R-90): proving the email ended a
 * link made before it was proven. Shown until dismissed or reconnected.
 */
export function LichessUnlinkedNotice(): JSX.Element {
  const t = useTranslations('settings.providers');
  return (
    <div
      role="note"
      className="flex flex-col gap-3 rounded-control bg-sunken px-4 py-3 text-fg"
    >
      <p>{t('lichessUnlinked')}</p>
      <form action={dismissLichessUnlinkedAction}>
        <button type="submit" className={SECONDARY_BUTTON}>
          {t('dismiss')}
        </button>
      </form>
    </div>
  );
}
