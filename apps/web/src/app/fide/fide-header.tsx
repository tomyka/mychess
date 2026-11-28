import { useTranslations } from 'next-intl';
import type { JSX } from 'react';
import { PageHeader } from '../shell/page-header';

/**
 * Opponents' title row, shared by the page and its loading state: the
 * title is the tab's name (#381), over what the page does.
 */
export function FideHeader(): JSX.Element {
  const t = useTranslations();
  return (
    <PageHeader title={t('nav.opponents')}>
      <p className="text-fg-muted">{t('fide.intro')}</p>
    </PageHeader>
  );
}
