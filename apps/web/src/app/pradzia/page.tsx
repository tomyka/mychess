import { accountStage, deletableAccount } from '@mychess/domain';
import { redirect } from 'next/navigation';
import type { JSX } from 'react';
import { returnPath } from '../../lib/return-path';
import { ROUTES } from '../../lib/routes';
import { hasFreshSession, requireAccount } from '../../server/session';
import { DeleteDisclosure } from './delete-disclosure';
import { OnboardingForm } from './onboarding-form';

type SearchParams = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

// Signed-out visitors go to sign-in; an account that has already been
// through this screen goes home, or on to the invite in `?next=` (R-81).
// One that would rather not stay can delete itself from here, confirming
// with its email (R-86).
export default async function OnboardingPage({
  searchParams,
}: {
  readonly searchParams: Promise<SearchParams>;
}): Promise<JSX.Element> {
  const account = await requireAccount();
  const next = returnPath(first((await searchParams)['next']));
  if (accountStage(account) === 'onboarded') redirect(next ?? ROUTES.home);
  return (
    <OnboardingForm
      displayName={account.displayName}
      locale={account.locale}
      next={next}
    >
      <DeleteDisclosure
        account={deletableAccount(account)}
        canExport={await hasFreshSession()}
      />
    </OnboardingForm>
  );
}
