import type { JSX } from 'react';
import { readLinkedQuery, type SearchParams } from '../lib/routes';
import { requireOnboarded } from '../server/session';
import { todayPage } from '../server/today-page';
import { AppShell } from './shell/app-shell';
import { TodayView } from './today/today-view';

// Signed-out visitors go to sign-in, new accounts to onboarding first.
// Accepting an invite lands here with `?linked=` and `?group=` (R-234).
export default async function HomePage({
  searchParams,
}: {
  readonly searchParams: Promise<SearchParams>;
}): Promise<JSX.Element> {
  const account = await requireOnboarded();
  const page = await todayPage(account, readLinkedQuery(await searchParams));
  return (
    <AppShell>
      <TodayView {...page} />
    </AppShell>
  );
}
