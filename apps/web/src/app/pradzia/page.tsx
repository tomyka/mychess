import { isOnboarded } from '@mychess/domain';
import { redirect } from 'next/navigation';
import type { JSX } from 'react';
import { ROUTES } from '../../lib/routes';
import { requireAccount } from '../../server/session';
import { OnboardingForm } from './onboarding-form';

// Signed-out visitors go to sign-in; an account that has already been
// through this screen goes home.
export default async function OnboardingPage(): Promise<JSX.Element> {
  const account = await requireAccount();
  if (isOnboarded(account)) redirect(ROUTES.home);
  return (
    <OnboardingForm displayName={account.displayName} locale={account.locale} />
  );
}
