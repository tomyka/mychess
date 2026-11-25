import { useTranslations } from 'next-intl';
import type { JSX } from 'react';
import { coachHomeData } from '../../server/coach-pages';
import { PageHeader } from '../shell/page-header';
import { CONTENT } from '../surfaces';
import { GroupsSection } from './groups-section';
import { InvitesSection } from './invites-section';
import { PlayersList } from './players-list';

function Header(): JSX.Element {
  const t = useTranslations('coach');
  return <PageHeader title={t('title')} />;
}

// The coach dashboard (plan decision 11): only the coach's own players, groups
// and invites, read through the loader. Without Coach mode the loader
// sends the account to settings, where the switch is.
export default async function CoachPage(): Promise<JSX.Element> {
  const { players, groups, invites } = await coachHomeData();
  return (
    <main className={`${CONTENT} gap-8`}>
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
        invites={invites.map(({ id, kind, groupName, expiresAt }) => ({
          id,
          kind,
          groupName,
          expiresAt,
        }))}
      />
    </main>
  );
}
