import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { JSX } from 'react';
import { ROUTES } from '../../lib/routes';
import { TEXT_LINK } from '../nustatymai/styles';

// A repertoire the player does not train, or a malformed id: both read the
// same, so the page does not tell whether a repertoire exists.
export default function TrainingNotFound(): JSX.Element {
  const t = useTranslations('training');
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-gutter py-8 sm:px-gutter-wide">
      <h1 className="text-2xl font-bold sm:text-3xl">{t('notFound')}</h1>
      <Link href={ROUTES.home} className={TEXT_LINK}>
        {t('home')}
      </Link>
    </main>
  );
}
