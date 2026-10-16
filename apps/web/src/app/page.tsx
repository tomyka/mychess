import type { JSX } from 'react';
import { requireOnboarded } from '../server/session';
import { HomeView } from './home-view';

// Signed-out visitors go to sign-in, new accounts to onboarding first.
export default async function HomePage(): Promise<JSX.Element> {
  const account = await requireOnboarded();
  return <HomeView displayName={account.displayName} />;
}
