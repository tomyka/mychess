import type { JSX } from 'react';
import { requireOnboarded } from '../server/session';
import { todayPage, type TodayParams } from '../server/today-page';
import { AppShell } from './shell/app-shell';
import { TodayView } from './today/today-view';

// Signed-out visitors go to sign-in, new accounts to onboarding first.
// Accepting an invite lands here with `?linked=` and `?group=` (R-234).
export default async function HomePage({
  searchParams,
}: {
  readonly searchParams: Promise<TodayParams>;
}): Promise<JSX.Element> {
  const account = await requireOnboarded();
  const { linked, group } = await searchParams;
  const page = await todayPage(account, { linked, group });
  return (
    <AppShell>
      <TodayView {...page} />
    </AppShell>
  );
}
