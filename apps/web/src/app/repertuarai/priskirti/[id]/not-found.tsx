import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { JSX } from 'react';
import { ROUTES } from '../../../../lib/routes';
import { TEXT_LINK } from '../../../nustatymai/styles';

// Not assigned, no longer assigned, forked, or a malformed id: all read the
// same (plan decision 12).
export default function AssignedRepertoireNotFound(): JSX.Element {
  const t = useTranslations('assignment.page');
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-gutter py-8 sm:px-gutter-wide">
      <h1 className="text-2xl font-bold sm:text-3xl">{t('notFound')}</h1>
      <Link href={ROUTES.home} className={TEXT_LINK}>
        {t('home')}
      </Link>
    </main>
  );
}
