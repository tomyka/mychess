import type { JSX } from 'react';
import { z } from 'zod';
import { CHAPTER_PARAM } from '../../../lib/routes';
import { coachAssignData } from '../../../server/coach-assignments';
import { repertoirePageData } from '../../../server/repertoires';
import { requireOnboarded } from '../../../server/session';
import { repertoireTraining } from '../../../server/training';
import { AssignPanel } from './assign-panel';
import { RepertoireScreen } from './repertoire-screen';

type SearchParams = Record<string, string | string[] | undefined>;

/** A chapter id from the query; anything else opens the first chapter. */
const chapterQuery = z.string().min(1).max(20);

// One repertoire (docs/design/repertoire-screen.md, section 2). Anything the
// account may not view, a malformed id included, is 404 (decision 12). The
// screen is keyed by version, so a reload after a stale save starts afresh.
// `?chapter=` opens it on that chapter (after an import, its first new
// one); a chapter it does not have opens the first. In Coach mode the
// owner also gets the assign panel (R-15). The owner trains it: the panel
// has the train buttons with its counts (R-142).
export default async function RepertoirePage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<SearchParams>;
}): Promise<JSX.Element> {
  const { id } = await params;
  const chapter = chapterQuery.safeParse((await searchParams)[CHAPTER_PARAM]);
  const { repertoire, graph, notes, names, sharing, coachNotes, forkNotes } =
    await repertoirePageData(id);
  const { assignedPlayers, panel } = await coachAssignData(repertoire.id);
  const training = await repertoireTraining(
    await requireOnboarded(),
    repertoire.id,
  );
  return (
    <RepertoireScreen
      key={repertoire.version}
      repertoire={{
        id: repertoire.id,
        name: repertoire.name,
        side: repertoire.side,
        version: repertoire.version,
      }}
      graph={graph}
      notes={notes}
      names={names}
      chapterId={chapter.success ? chapter.data : null}
      sharing={sharing}
      coachNotes={coachNotes}
      forkNotes={forkNotes}
      assignedPlayers={assignedPlayers}
      training={
        training === null
          ? null
          : { repertoireId: repertoire.id, counts: training }
      }
      assignPanel={
        panel === null ? null : (
          <AssignPanel repertoireId={repertoire.id} data={panel} />
        )
      }
    />
  );
}
