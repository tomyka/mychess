/**
 * The nightly pre-index of the broadcast months (#354, R-195): of the 12
 * newest published months, every one the domain says to process is handed
 * to this process's runner, unawaited, so a search finds it ready. The
 * runner is single-flight and claims each month under a row lock, so a run
 * overlapping a search or another run downloads nothing twice.
 */
import { broadcastMonthStatuses } from '@mychess/db';
import { nextBroadcastMonthAction, searchMonths } from '@mychess/domain';
import { getDb } from './db';
import { fideServices } from './fide-services';

/** How many of the newest months were handed to the runner, and are ready. */
export interface PreindexCounts {
  readonly queued: number;
  readonly ready: number;
}

/**
 * Hands the months still to index at `now` to the runner; fails when the
 * month list or their statuses cannot be read.
 */
export async function preindexBroadcastMonths(
  now: Date,
): Promise<PreindexCounts> {
  const { sources, runner } = fideServices();
  const months = searchMonths(await sources.months());
  const actions = (await broadcastMonthStatuses(getDb(), months)).map(
    ({ month, status }) => ({
      month,
      action: nextBroadcastMonthAction(status, now),
    }),
  );
  const queued = actions
    .filter(({ action }) => action === 'process')
    .map(({ month }) => month);
  runner.need(queued);
  return {
    queued: queued.length,
    ready: actions.filter(({ action }) => action === 'use').length,
  };
}
