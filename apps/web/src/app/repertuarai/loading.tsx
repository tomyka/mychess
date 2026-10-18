import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

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

// Mano repertuarai while it loads (docs/design/repertoire-screen.md,
// States): the header, then three card skeletons per side. No spinner.
export default function RepertoiresLoading(): JSX.Element {
  const t = useTranslations('repertoires.list');
  return (
    <main
      aria-busy="true"
      className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-gutter py-8 sm:px-gutter-wide"
    >
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold sm:text-3xl">{t('title')}</h1>
        <p className="text-fg-muted">{t('intro')}</p>
      </header>
      <div className="grid gap-8 sm:grid-cols-2">
        <SkeletonGroup />
        <SkeletonGroup />
      </div>
    </main>
  );
}
