import type { JSX } from 'react';
import { requireOnboarded } from '../server/session';
import { todayPage } from '../server/today-page';
import { AppShell } from './shell/app-shell';
import { TodayView } from './today/today-view';

// Signed-out visitors go to sign-in, new accounts to onboarding first.
export default async function HomePage(): Promise<JSX.Element> {
  const account = await requireOnboarded();
  const page = await todayPage(account);
  return (
    <AppShell>
      <TodayView {...page} />
    </AppShell>
  );
}
