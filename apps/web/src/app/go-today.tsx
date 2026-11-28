import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';
import { ROUTES } from '../lib/routes';
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from './buttons';

const LOOKS = { primary: PRIMARY_BUTTON, secondary: SECONDARY_BUTTON };

/**
 * "Go to Today": the way home from a page that has nothing else to offer
 * (the 404), or beside the page's own action (the error page's Try again).
 */
export function GoToday({
  look,
}: {
  readonly look: keyof typeof LOOKS;
}): JSX.Element {
  const t = useTranslations('nav');
  return (
    <Link href={ROUTES.home} className={`${LOOKS[look]} self-start`}>
      {t('goToday')}
    </Link>
  );
}
