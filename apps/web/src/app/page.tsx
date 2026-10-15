import type { JSX } from 'react';
import { useTranslations } from 'next-intl';

export default function HomePage(): JSX.Element {
  const t = useTranslations('app');
  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-3xl font-bold">{t('title')}</h1>
    </main>
  );
}
