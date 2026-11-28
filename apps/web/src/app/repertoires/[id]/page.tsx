import type { JSX } from 'react';
import { readRepertoireQuery, type SearchParams } from '../../../lib/routes';
import { repertoirePageData } from '../../../server/repertoires';
import { RepertoireScreen } from './repertoire-screen';

// One repertoire (docs/design/repertoire-screen.md, section 2). Anything the
// account may not view, a malformed id included, is 404 (decision 12). The
// screen is keyed by version, so a reload after a stale save starts afresh.
// `?chapter=` opens it on that chapter (after an import, its first new
// one); a chapter it does not have opens the first. The owner trains it:
// the summary line has Review and Learn with its counts (R-142). Sharing,
// assigning and the other actions are on its Repertoire screen (R-226).
export default async function RepertoirePage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<SearchParams>;
}): Promise<JSX.Element> {
  const { id } = await params;
  const { chapterId } = readRepertoireQuery(await searchParams);
  const { repertoire, graph, notes, names, coachNotes, forkNotes, training } =
    await repertoirePageData(id);
  return (
    <RepertoireScreen
      key={repertoire.version}
      repertoire={repertoire}
      graph={graph}
      notes={notes}
      names={names}
      chapterId={chapterId}
      coachNotes={coachNotes}
      forkNotes={forkNotes}
      training={training}
    />
  );
}
