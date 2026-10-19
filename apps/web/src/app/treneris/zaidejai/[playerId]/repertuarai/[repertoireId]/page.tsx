import type { JSX } from 'react';
import { sharedRepertoireData } from '../../../../../../server/coach-pages';
import { SharedRepertoireView } from './shared-repertoire-view';

// A player's repertoire shared with the coach, read-only (plan decision
// 11). The loader decides: not shared with this coach, a player not
// linked, or a malformed id is 404 (plan decision 4).
export default async function CoachSharedRepertoirePage({
  params,
}: {
  readonly params: Promise<{ playerId: string; repertoireId: string }>;
}): Promise<JSX.Element> {
  const { playerId, repertoireId } = await params;
  return (
    <SharedRepertoireView
      data={await sharedRepertoireData(playerId, repertoireId)}
    />
  );
}
