import { useTranslations } from 'next-intl';
import type { JSX } from 'react';
import { readRepertoiresQuery, type SearchParams } from '../../../lib/routes';
import { myAssignedRepertoires } from '../../../server/assignment-pages';
import { myRepertoires } from '../../../server/repertoires';
import { requireOnboarded } from '../../../server/session';
import { trainedStandings } from '../../../server/training';
import { CONTENT } from '../../surfaces';
import { StatusLine } from '../../status-line';
import { NewRepertoire } from '../new-repertoire';
import { RepertoireList } from '../repertoire-list';

/** After a delete, the repertoire page comes here with `?deleted=1`. */
function DeletedNotice({ shown }: { readonly shown: boolean }): JSX.Element {
  const t = useTranslations('repertoires.manage');
  return <StatusLine text={shown ? t('deleted') : null} tone="success" />;
}

// In the (list) route group so its loading.tsx wraps this page alone: a
// streamed child page answers 200 even when it is not found (#331).
// My repertoires (spec 2026-11-26 "My repertoires"): New and Import PGN in
// the header, then the account's own repertoires and those assigned to it
// (#328) by side, each with its standing from the read Today shares (R-225).
export default async function RepertoiresPage({
  searchParams,
}: {
  readonly searchParams: Promise<SearchParams>;
}): Promise<JSX.Element> {
  const [items, assigned, standings] = await Promise.all([
    myRepertoires(),
    myAssignedRepertoires(),
    requireOnboarded().then(trainedStandings),
  ]);
  const { deleted } = readRepertoiresQuery(await searchParams);
  // With no repertoire at all, the list is its one empty line, above the
  // open form; otherwise the form opens above the list (spec).
  const empty = items.length + assigned.length === 0;
  const list = (
    <RepertoireList
      items={items}
      assigned={assigned}
      standings={standings}
      now={new Date()}
    />
  );
  return (
    <main className={`${CONTENT} gap-8`}>
      <NewRepertoire startOpen={empty}>
        <DeletedNotice shown={deleted} />
        {empty ? list : null}
      </NewRepertoire>
      {empty ? null : list}
    </main>
  );
}
