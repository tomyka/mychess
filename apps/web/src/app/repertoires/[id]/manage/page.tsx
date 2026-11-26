import type { JSX } from 'react';
import { coachAssignData } from '../../../../server/coach-assignments';
import { repertoireManageData } from '../../../../server/repertoires';
import { ManageScreen } from './manage-screen';

// The Repertoire screen of an own repertoire (R-226). The loader reads
// only the session account's own: anything else, a malformed id or a
// repertoire it has only by assignment included, is 404 (decision 12; the
// layout above decides it before streaming). In Coach mode it has whom
// the repertoire is assigned to, with their progress (R-225).
export default async function RepertoireManagePage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}): Promise<JSX.Element> {
  const { id } = await params;
  const { repertoire, sharing } = await repertoireManageData(id);
  const { assignedPlayers, panel } = await coachAssignData(repertoire.id);
  return (
    <ManageScreen
      repertoire={{ id: repertoire.id, name: repertoire.name }}
      sharing={sharing}
      assignedPlayers={assignedPlayers}
      assignPanel={panel}
    />
  );
}
