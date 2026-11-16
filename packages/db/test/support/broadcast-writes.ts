// Writes synthetic broadcast months and tournaments through the
// repositories, as the runner does, for the broadcast search tests.
import type { BroadcastGameInput } from '@mychess/domain';
import {
  claimBroadcastMonth,
  claimBroadcastTour,
  queueBroadcastTour,
  writeBroadcastMonth,
  writeBroadcastTour,
} from '../../src';
import type { Executor } from '../../src/client';
import { NOW, TOUR_ROUND, month, queuedTour, tourId } from './broadcasts';

/** Claims `text`'s month at NOW and writes `games` into it. */
export async function writeMonth(
  db: Executor,
  text: string,
  games: readonly BroadcastGameInput[],
): Promise<void> {
  const claim = await claimBroadcastMonth(db, month(text), NOW);
  if (!claim.ok) throw new Error(`claim refused: ${claim.refusal.reason}`);
  const result = await writeBroadcastMonth(db, {
    claim: claim.value,
    games,
    clock: () => NOW,
  });
  if (!result.ok) throw new Error(`write refused: ${result.refusal.reason}`);
}

/** Queues the tournament `id`, claims it and writes `games` of TOUR_ROUND. */
export async function writeTour(
  db: Executor,
  id: string,
  games: readonly BroadcastGameInput[],
  tour: Parameters<typeof queuedTour>[1] = {},
): Promise<void> {
  await queueBroadcastTour(db, queuedTour(id, tour));
  const claim = await claimBroadcastTour(db, tourId(id), NOW);
  if (!claim.ok) throw new Error(`claim refused: ${claim.refusal.reason}`);
  const result = await writeBroadcastTour(db, {
    claim: claim.value,
    roundIds: [TOUR_ROUND],
    games,
    clock: () => NOW,
  });
  if (!result.ok) throw new Error(`write refused: ${result.refusal.reason}`);
}
