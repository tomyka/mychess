import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

type Messages = ReturnType<typeof useTranslations<'coach.progress'>>;

/**
 * "Last trained today / yesterday / N days ago", or "not trained yet"
 * (R-154). The short form, for rows, says only "today", "5 days ago" or
 * "never", with LastTrainedNote once under the list.
 */
export function LastTrained({
  days,
  form = 'long',
}: {
  readonly days: number | null;
  readonly form?: 'long' | 'short';
}): JSX.Element {
  const t = useTranslations('coach.progress');
  return form === 'short' ? (
    <span className="text-sm text-fg-muted">{short(t, days)}</span>
  ) : (
    <p className="text-sm text-fg-muted">{long(t, days)}</p>
  );
}

/** What the short form counts: only what the coach may see (R-154). */
export function LastTrainedNote(): JSX.Element {
  const t = useTranslations('coach.progress');
  return <p className="text-sm text-fg-muted">{t('lastTrainedNote')}</p>;
}

function short(t: Messages, days: number | null): string {
  if (days === null) return t('trained.never');
  if (days === 0) return t('trained.today');
  if (days === 1) return t('trained.yesterday');
  return t('trained.daysAgo', { days });
}

function long(t: Messages, days: number | null): string {
  if (days === null) return t('neverTrained');
  if (days === 0) return t('today');
  if (days === 1) return t('yesterday');
  return t('daysAgo', { days });
}
