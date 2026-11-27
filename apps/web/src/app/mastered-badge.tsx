import { useTranslations } from 'next-intl';
import type { JSX } from 'react';
import { Pill } from './pill';

/**
 * The Mastered pill (R-151, R-178), the same wherever progress is shown:
 * the standing line, the summary row, Today's rows and the coach's
 * progress counts and grid.
 */
export function MasteredBadge(): JSX.Element {
  const t = useTranslations('coach.progress');
  return <Pill tone="mastered">{t('mastered')}</Pill>;
}
