import type { JSX } from 'react';
import { z } from 'zod';
import { CHAPTER_PARAM } from '../../../lib/routes';
import { repertoirePageData } from '../../../server/repertoires';
import { RepertoireScreen } from './repertoire-screen';

type SearchParams = Record<string, string | string[] | undefined>;

/** A chapter id from the query; anything else opens the first chapter. */
const chapterQuery = z.string().min(1).max(20);

// One repertoire (docs/design/repertoire-screen.md, section 2). Anything the
// account may not view, a malformed id included, is 404 (decision 12). The
// screen is keyed by version, so a reload after a stale save starts afresh.
// `?chapter=` opens it on that chapter (after an import, its first new
// one); a chapter it does not have opens the first.
export default async function RepertoirePage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<SearchParams>;
}): Promise<JSX.Element> {
  const { id } = await params;
  const chapter = chapterQuery.safeParse((await searchParams)[CHAPTER_PARAM]);
  const { repertoire, graph, notes, ecoNames, sharing, coachNotes, forkNotes } =
    await repertoirePageData(id);
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
      ecoNames={ecoNames}
      chapterId={chapter.success ? chapter.data : null}
      sharing={sharing}
      coachNotes={coachNotes}
      forkNotes={forkNotes}
    />
  );
}
