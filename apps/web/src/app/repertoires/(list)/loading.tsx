import { useTranslations } from 'next-intl';
import type { JSX } from 'react';
import { PageHeader } from '../../shell/page-header';
import { CONTENT } from '../../surfaces';

const CARD = 'h-24 rounded-card bg-sunken';

function SkeletonGroup(): JSX.Element {
  return (
    <div aria-hidden="true" className="flex flex-col gap-3">
      <div className="h-7 w-32 rounded-control bg-sunken" />
      <div className={CARD} />
      <div className={CARD} />
      <div className={CARD} />
    </div>
  );
}

// My repertoires while it loads (docs/design/repertoire-screen.md,
// States): the header, then three card skeletons per side. No spinner.
export default function RepertoiresLoading(): JSX.Element {
  const t = useTranslations('repertoires.list');
  return (
    <main aria-busy="true" className={`${CONTENT} gap-8`}>
      <PageHeader title={t('title')}>
        <p className="text-fg-muted">{t('intro')}</p>
      </PageHeader>
      <div className="grid gap-8 sm:grid-cols-2">
        <SkeletonGroup />
        <SkeletonGroup />
      </div>
    </main>
  );
}
