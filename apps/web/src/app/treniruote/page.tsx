import { notFound } from 'next/navigation';
import type { JSX } from 'react';
import { requireOnboarded } from '../../server/session';
import { loadTraining, parseTrainingSearch } from '../../server/training';
import { TrainingScreen } from './training-screen';

type SearchParams = Record<string, string | string[] | undefined>;

// The training page (S6): `?mode=review|learn`, and `&r=` to train one
// repertoire (R-142). Signed-out visitors go to sign-in, new accounts to
// onboarding. The loader starts from the session account; a repertoire it
// does not train, or a malformed id, is 404.
export default async function TrainingPage({
  searchParams,
}: {
  readonly searchParams: Promise<SearchParams>;
}): Promise<JSX.Element> {
  const account = await requireOnboarded();
  const { mode, scope } = parseTrainingSearch(await searchParams);
  const data = await loadTraining(account, mode, scope);
  if (data === undefined) notFound();
  return (
    <TrainingScreen
      data={data}
      accountId={account.id}
      repertoireId={scope.kind === 'repertoire' ? scope.repertoireId : null}
    />
  );
}
