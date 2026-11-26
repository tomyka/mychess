import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

/**
 * The Mastered pill (R-151, R-178), the same wherever progress is shown:
 * the standing line, the summary row, Today's rows and the coach's state
 * bar and grid.
 */
export function MasteredBadge(): JSX.Element {
  const t = useTranslations('coach.progress');
  return (
    <span className="w-fit rounded-pill border border-transparent bg-success-subtle px-2 py-0.5 text-sm font-semibold text-success">
      {t('mastered')}
    </span>
  );
}
