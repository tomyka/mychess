import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { JSX } from 'react';
import { ROUTES } from '../../../lib/routes';
import { TEXT_LINK } from '../../nustatymai/styles';

// Another account's repertoire and a malformed id read the same (decision 12).
export default function RepertoireNotFound(): JSX.Element {
  const t = useTranslations();
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-gutter py-8 sm:px-gutter-wide">
      <h1 className="text-2xl font-bold sm:text-3xl">
        {t('repertoire.notFound')}
      </h1>
      <Link href={ROUTES.repertoires} className={TEXT_LINK}>
        {t('repertoires.header.back')}
      </Link>
    </main>
  );
}
