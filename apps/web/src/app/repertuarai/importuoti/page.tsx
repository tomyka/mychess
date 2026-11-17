import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { JSX } from 'react';
import { ROUTES } from '../../../lib/routes';
import { lichessUsername } from '../../../server/provider-links';
import { myRepertoires } from '../../../server/repertoires';
import { requireOnboarded } from '../../../server/session';
import { TEXT_LINK } from '../../nustatymai/styles';
import { ImportFlow } from './import-flow';

type SearchParams = Record<string, string | string[] | undefined>;

function Header(): JSX.Element {
  const t = useTranslations('repertoires.import');
  return (
    <header className="flex flex-col gap-1">
      <Link href={ROUTES.repertoires} className={TEXT_LINK}>
        {t('back')}
      </Link>
      <h1 className="text-2xl font-bold sm:text-3xl">{t('title')}</h1>
      <p className="text-fg-muted">{t('intro')}</p>
    </header>
  );
}

/**
 * The names a file's players may give the account by (#330 decision 8): its
 * display name, and its Lichess username when Lichess is linked. Only the
 * session account's own, sent to its own browser.
 */
async function ownNames(): Promise<string[]> {
  const account = await requireOnboarded();
  const lichess = await lichessUsername();
  return lichess === null
    ? [account.displayName]
    : [account.displayName, lichess];
}

// The PGN import (docs/design/repertoire-screen.md, section 3). `?i=` names
// the repertoire it was opened from; it counts only when it is one of the
// account's own (myRepertoires lists only those).
export default async function ImportPage({
  searchParams,
}: {
  readonly searchParams: Promise<SearchParams>;
}): Promise<JSX.Element> {
  const items = await myRepertoires();
  const names = await ownNames();
  const { i } = await searchParams;
  const options = items.map(({ id, name, side }) => ({ id, name, side }));
  const preselected = options.find((option) => option.id === i)?.id ?? null;
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-gutter py-8 sm:px-gutter-wide">
      <Header />
      <ImportFlow options={options} preselected={preselected} names={names} />
    </main>
  );
}
