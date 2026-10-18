import type { JSX } from 'react';
import { coachPlayerData } from '../../../../server/coach-pages';
import { PlayerView } from './player-view';

// One linked player (plan decision 11). The loader decides who may see
// them; a player not linked to the coach and a malformed id are 404.
export default async function CoachPlayerPage({
  params,
}: {
  readonly params: Promise<{ playerId: string }>;
}): Promise<JSX.Element> {
  const { id, displayName, linkedAt, groups } = await coachPlayerData(
    (await params).playerId,
  );
  return <PlayerView player={{ id, displayName, linkedAt, groups }} />;
}
