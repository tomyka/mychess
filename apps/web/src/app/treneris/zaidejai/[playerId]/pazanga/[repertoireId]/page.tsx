import type { JSX } from 'react';
import { coachProgressData } from '../../../../../../server/coach-progress';
import { ProgressView } from './progress-view';

// One player's progress on one repertoire (R-152). The loader decides who
// may see it: an unlinked player, a private or forked repertoire (R-155)
// and a malformed id are all 404 (plan decision 4).
export default async function CoachProgressPage({
  params,
}: {
  readonly params: Promise<{ playerId: string; repertoireId: string }>;
}): Promise<JSX.Element> {
  const { playerId, repertoireId } = await params;
  return (
    <ProgressView page={await coachProgressData(playerId, repertoireId)} />
  );
}
