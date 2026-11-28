import { accountStage, deletableAccount } from '@mychess/domain';
import { redirect } from 'next/navigation';
import type { JSX } from 'react';
import { returnPath } from '../../lib/return-path';
import { ROUTES } from '../../lib/routes';
import { teaserOf } from '../../server/invite-teaser';
import { hasFreshSession, requireAccount } from '../../server/session';
import { DeleteAccountControl } from '../delete-account-control';
import { EntryFrame } from '../entry-frame';
import { OnboardingForm } from './onboarding-form';

type SearchParams = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

// Signed-out visitors go to sign-in; an account that has already been
// through this screen goes home, or on to the invite in `?next=` (R-81),
// whose coach it names when the invite is valid (R-235). One that would
// rather not stay can delete itself from here, confirming with its email
// (R-86), from a quiet link under the card that opens the delete sheet.
export default async function OnboardingPage({
  searchParams,
}: {
  readonly searchParams: Promise<SearchParams>;
}): Promise<JSX.Element> {
  const account = await requireAccount();
  const next = returnPath(first((await searchParams)['next']));
  if (accountStage(account) === 'onboarded') redirect(next ?? ROUTES.home);
  return (
    <EntryFrame
      below={
        <DeleteAccountControl
          account={deletableAccount(account)}
          canExport={await hasFreshSession()}
          variant="link"
        />
      }
    >
      <OnboardingForm
        displayName={account.displayName}
        next={next}
        teaser={await teaserOf(next)}
      />
    </EntryFrame>
  );
}
