import { isCoach } from '@mychess/domain';
import type { JSX } from 'react';
import { homeAssignments } from '../server/assignment-pages';
import { requireOnboarded } from '../server/session';
import { todaySummary } from '../server/training';
import { HomeView } from './home-view';

// Signed-out visitors go to sign-in, new accounts to onboarding first.
export default async function HomePage(): Promise<JSX.Element> {
  const account = await requireOnboarded();
  const { fromCoach, offers } = await homeAssignments();
  const today = await todaySummary(account);
  return (
    <HomeView
      displayName={account.displayName}
      isCoach={isCoach(account)}
      fromCoach={fromCoach}
      offers={offers}
      today={today}
    />
  );
}
