import { useTranslations } from 'next-intl';
import type { JSX } from 'react';
import { CardSkeletons } from '../card-skeletons';
import { PageHeader } from '../shell/page-header';
import { CONTENT } from '../surfaces';

/** Opponents while it loads: its header, then the search card. */
export default function FideLoading(): JSX.Element {
  const t = useTranslations('fide');
  return (
    <main aria-busy="true" className={`${CONTENT} gap-6`}>
      <PageHeader title={t('title')}>
        <p className="text-fg-muted">{t('intro')}</p>
      </PageHeader>
      <CardSkeletons sizes={['h-36']} />
    </main>
  );
}
