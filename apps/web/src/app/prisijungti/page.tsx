import type { JSX } from 'react';
import { redirect } from 'next/navigation';
import { returnPath } from '../../lib/return-path';
import { ROUTES } from '../../lib/routes';
import { googleConfigured, readWebEnv } from '../../server/env';
import { getAccount } from '../../server/session';
import { SignInForm } from './sign-in-form';

type SearchParams = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

// Signed-in accounts go home, or on to the invite in `?next=` (R-81);
// Better Auth sends failed sign-ins back here with `?error=`, and account
// deletion with `?deleted=1`.
export default async function SignInPage({
  searchParams,
}: {
  readonly searchParams: Promise<SearchParams>;
}): Promise<JSX.Element> {
  const params = await searchParams;
  const next = returnPath(first(params['next']));
  if ((await getAccount()) !== null) redirect(next ?? ROUTES.home);
  return (
    <SignInForm
      error={first(params['error'])}
      deleted={first(params['deleted']) === '1'}
      googleEnabled={googleConfigured(readWebEnv())}
      next={next}
    />
  );
}
