import { useTranslations } from 'next-intl';
import type { JSX, ReactNode } from 'react';
import { coachDashboardData } from '../../server/coach-pages';
import { PageHeader } from '../shell/page-header';
import { CONTENT } from '../surfaces';
import { GroupsSection } from './groups-section';
import { InviteSheet } from './invite-sheet';
import { NeedsAttention } from './needs-attention';
import { PlayersList } from './players-list';

function Header({ actions }: { readonly actions: ReactNode }): JSX.Element {
  const t = useTranslations('coach');
  return <PageHeader title={t('title')} actions={actions} />;
}

// The coach dashboard (R-229, plan decision 11): who needs attention, then
// every player, and the groups beside them from lg; only the coach's own
// players, groups and invites, read through the loader. Invite a player
// sits in the header (R-232), and again under "no player yet". Without
// Coach mode the loader sends the account to settings, where the switch is.
export default async function CoachPage(): Promise<JSX.Element> {
  const { attention, players, groups, personalInvites, today } =
    await coachDashboardData();
  const invite = <InviteSheet invites={personalInvites} today={today} />;
  return (
    <main className={`${CONTENT} gap-8`}>
      <Header actions={invite} />
      <div className="flex flex-col gap-8 lg:grid lg:grid-cols-[minmax(0,1fr)_17rem] lg:items-start">
        <div className="flex min-w-0 flex-col gap-8">
          <NeedsAttention cards={attention} />
          <PlayersList players={players} today={today} invite={invite} />
        </div>
        <GroupsSection groups={groups} today={today} />
      </div>
    </main>
  );
}
