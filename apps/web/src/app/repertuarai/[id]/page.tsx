import type { JSX } from 'react';
import { repertoirePageData } from '../../../server/repertoires';
import { RepertoireScreen } from './repertoire-screen';

// One repertoire (docs/design/repertoire-screen.md, section 2). Anything the
// account may not view, a malformed id included, is 404 (decision 12). The
// screen is keyed by version, so a reload after a stale save starts afresh.
export default async function RepertoirePage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}): Promise<JSX.Element> {
  const { id } = await params;
  const { repertoire, graph, notes, ecoNames } = await repertoirePageData(id);
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
    />
  );
}
