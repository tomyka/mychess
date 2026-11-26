import { useTranslations } from 'next-intl';
import type { JSX } from 'react';
import { ROUTES } from '../../../lib/routes';
import { lichessUsername } from '../../../server/provider-links';
import { importTargets } from '../../../server/repertoires';
import { requireOnboarded } from '../../../server/session';
import { PageHeader } from '../../shell/page-header';
import { CONTENT } from '../../surfaces';
import { ImportFlow } from './import-flow';

type SearchParams = Record<string, string | string[] | undefined>;

function Header(): JSX.Element {
  const t = useTranslations();
  return (
    <PageHeader
      back={{ href: ROUTES.repertoires, parent: t('nav.repertoires') }}
      title={t('repertoires.import.title')}
    >
      <p className="text-fg-muted">{t('repertoires.import.intro')}</p>
    </PageHeader>
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
// account's own (importTargets lists only those).
export default async function ImportPage({
  searchParams,
}: {
  readonly searchParams: Promise<SearchParams>;
}): Promise<JSX.Element> {
  const options = await importTargets();
  const names = await ownNames();
  const { i } = await searchParams;
  const opened = options.find((option) => option.id === i) ?? null;
  return (
    <main className={`${CONTENT} gap-8`}>
      <Header />
      <ImportFlow options={options} opened={opened} names={names} />
    </main>
  );
}
