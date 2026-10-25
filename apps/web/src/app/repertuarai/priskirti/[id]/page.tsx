import type { JSX } from 'react';
import { assignedRepertoireData } from '../../../../server/assignment-pages';
import { requireOnboarded } from '../../../../server/session';
import { repertoireTraining } from '../../../../server/training';
import { forkAction } from './actions';
import { AssignedView } from './assigned-view';

// A repertoire the player has from their coach (plan decision 11). The
// loader decides: not assigned to the session player now, forked, or a
// malformed id is 404 (plan decision 12). The view is keyed by version, so
// a coach's later edit opens afresh. The player trains it: the panel has
// the train buttons with its counts unless it is paused (R-142, R-46).
export default async function AssignedRepertoirePage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}): Promise<JSX.Element> {
  const { id } = await params;
  const data = await assignedRepertoireData(id);
  const training = await repertoireTraining(
    await requireOnboarded(),
    data.repertoire.id,
  );
  return (
    <AssignedView
      key={data.repertoire.version}
      data={data}
      forkAction={forkAction}
      training={training}
    />
  );
}
