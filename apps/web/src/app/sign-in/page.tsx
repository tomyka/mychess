import type { JSX } from 'react';
import { redirect } from 'next/navigation';
import { readSignInQuery } from '../../lib/return-path';
import { ROUTES, type SearchParams } from '../../lib/routes';
import { googleConfigured, readWebEnv } from '../../server/env';
import { teaserOf } from '../../server/invite-teaser';
import { getAccount } from '../../server/session';
import { EntryFrame } from '../entry-frame';
import { SignInForm } from './sign-in-form';

// Signed-in accounts go home, or on to the invite in `?next=` (R-81);
// Better Auth sends failed sign-ins back here with `?error=`, and account
// deletion with `?deleted=1`. From a valid invite it names the coach and
// group (R-235).
export default async function SignInPage({
  searchParams,
}: {
  readonly searchParams: Promise<SearchParams>;
}): Promise<JSX.Element> {
  const { next, error, deleted } = readSignInQuery(await searchParams);
  if ((await getAccount()) !== null) redirect(next ?? ROUTES.home);
  return (
    <EntryFrame>
      <SignInForm
        error={error}
        deleted={deleted}
        googleEnabled={googleConfigured(readWebEnv())}
        next={next}
        teaser={await teaserOf(next)}
      />
    </EntryFrame>
  );
}
