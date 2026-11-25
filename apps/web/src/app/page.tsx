import type { JSX } from 'react';
import { homeAssignments } from '../server/assignment-pages';
import { requireOnboarded } from '../server/session';
import { todaySummary } from '../server/training';
import { HomeView } from './home-view';
import { AppShell } from './shell/app-shell';

// Signed-out visitors go to sign-in, new accounts to onboarding first.
export default async function HomePage(): Promise<JSX.Element> {
  const account = await requireOnboarded();
  const { fromCoach, offers } = await homeAssignments();
  const today = await todaySummary(account);
  return (
    <AppShell>
      <HomeView
        displayName={account.displayName}
        fromCoach={fromCoach}
        offers={offers}
        today={today}
      />
    </AppShell>
  );
}
