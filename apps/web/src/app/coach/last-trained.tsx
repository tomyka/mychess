import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

/**
 * Days since the player last trained in words: "today", "yesterday",
 * "5 days ago" (R-154). For a line that says "trained …" itself.
 */
export function useTrainedWhen(): (days: number) => string {
  const t = useTranslations('coach.progress.trained');
  return (days) => {
    if (days === 0) return t('today');
    if (days === 1) return t('yesterday');
    return t('daysAgo', { days });
  };
}

/**
 * When the player last trained, for rows (R-154, R-231): "today",
 * "yesterday", "5 days ago" or "never", with LastTrainedNote once under
 * the list saying it counts only what the coach can see.
 */
export function LastTrained({
  days,
}: {
  readonly days: number | null;
}): JSX.Element {
  const t = useTranslations('coach.progress.trained');
  const when = useTrainedWhen();
  return (
    <span className="text-sm text-fg-muted">
      {days === null ? t('never') : when(days)}
    </span>
  );
}

/** What LastTrained counts: only what the coach may see (R-154). */
export function LastTrainedNote(): JSX.Element {
  const t = useTranslations('coach.progress');
  return <p className="text-sm text-fg-muted">{t('lastTrainedNote')}</p>;
}
