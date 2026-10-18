import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { JSX } from 'react';
import { ROUTES } from '../../lib/routes';
import { coachHomeData } from '../../server/coach-pages';
import { TEXT_LINK } from '../nustatymai/styles';
import { GroupsSection } from './groups-section';
import { InvitesSection } from './invites-section';
import { PlayersList } from './players-list';

function Header(): JSX.Element {
  const t = useTranslations('coach');
  return (
    <header className="flex flex-col gap-1">
      <Link href={ROUTES.home} className={TEXT_LINK}>
        {t('home')}
      </Link>
      <h1 className="text-2xl font-bold sm:text-3xl">{t('title')}</h1>
    </header>
  );
}

// The coach area (plan decision 11): only the coach's own players, groups
// and invites, read through the loader. Without Coach mode the loader
// sends the account to settings, where the switch is.
export default async function CoachPage(): Promise<JSX.Element> {
  const { players, groups, invites } = await coachHomeData();
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-gutter py-8 sm:px-gutter-wide">
      <Header />
      <PlayersList players={players} />
      <GroupsSection
        groups={groups.map(({ id, name, memberCount }) => ({
          id,
          name,
          memberCount,
        }))}
      />
      <InvitesSection
        groups={groups.map(({ id, name }) => ({ id, name }))}
        invites={invites.map(({ id, kind, groupName, state, expiresAt }) => ({
          id,
          kind,
          groupName,
          state,
          expiresAt,
        }))}
      />
    </main>
  );
}
