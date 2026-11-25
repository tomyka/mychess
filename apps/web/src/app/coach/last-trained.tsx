import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

/** "Last trained today / yesterday / N days ago", or "not trained yet" (R-154). */
export function LastTrained({
  days,
}: {
  readonly days: number | null;
}): JSX.Element {
  const t = useTranslations('coach.progress');
  return <p className="text-sm text-fg-muted">{text(t, days)}</p>;
}

function text(
  t: ReturnType<typeof useTranslations<'coach.progress'>>,
  days: number | null,
): string {
  if (days === null) return t('neverTrained');
  if (days === 0) return t('today');
  if (days === 1) return t('yesterday');
  return t('daysAgo', { days });
}
