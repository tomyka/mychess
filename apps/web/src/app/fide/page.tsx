import { FOUND_GAMES_LIMIT } from '@mychess/db';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { JSX } from 'react';
import { ROUTES } from '../../lib/routes';
import { requireOnboarded } from '../../server/session';
import { TEXT_LINK } from '../nustatymai/styles';
import { FideSearch } from './fide-search';

function Header(): JSX.Element {
  const t = useTranslations('fide');
  return (
    <header className="flex flex-col gap-1">
      <Link href={ROUTES.home} className={TEXT_LINK}>
        {t('home')}
      </Link>
      <h1 className="text-2xl font-bold sm:text-3xl">{t('title')}</h1>
      <p className="text-fg-muted">{t('intro')}</p>
    </header>
  );
}

/**
 * The FIDE ID search (#316): any signed-in account (R-186) lists a
 * player's Lichess broadcast games of the last 12 months, to prepare for
 * them (R-171). Next serves it with `Referrer-Policy: no-referrer`
 * (next.config.ts).
 */
export default async function FidePage(): Promise<JSX.Element> {
  await requireOnboarded();
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-gutter py-8 sm:px-gutter-wide">
      <Header />
      <FideSearch truncatedLimit={FOUND_GAMES_LIMIT} />
    </main>
  );
}
