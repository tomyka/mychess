/**
 * The nightly upkeep of the broadcast index (#354, R-195; #349 spec
 * decision 3): of the 12 newest published months, every one the domain
 * says to process is handed to this process's runner, unawaited, so a
 * search finds it ready. The runner is single-flight and claims each month
 * under a row lock, so a run overlapping a search or another run
 * downloads nothing twice.
 *
 * With a Lichess token it also starts the community broadcasts' night,
 * unawaited (broadcast-community.ts): the approved organisers are listed
 * and the tournaments due are handed to the same runner. Without one that
 * part is off, said once a night in the log; the months go on as before.
 */
import { broadcastMonthStatuses } from '@mychess/db';
import {
  broadcastWindow,
  nextBroadcastMonthAction,
  searchMonths,
} from '@mychess/domain';
import { getDb } from './db';
import { fideServices } from './fide-services';

/**
 * How many of the newest months were handed to the runner, and are ready;
 * and whether the community broadcasts' night was started, was running
 * already, or is off.
 */
export interface PreindexCounts {
  readonly queued: number;
  readonly ready: number;
  readonly community: 'started' | 'running' | 'off';
}

/**
 * Hands the months still to index at `now` to the runner and starts the
 * community night; fails when the month list or their statuses cannot be
 * read.
 */
export async function preindexBroadcasts(now: Date): Promise<PreindexCounts> {
  const { sources, runner, community } = fideServices();
  const published = await sources.months();
  const actions = (
    await broadcastMonthStatuses(getDb(), searchMonths(published))
  ).map(({ month, status }) => ({
    month,
    action: nextBroadcastMonthAction(status, now),
  }));
  const queued = actions
    .filter(({ action }) => action === 'process')
    .map(({ month }) => month);
  runner.need(queued);
  if (community === null) {
    console.warn(
      'fide: LICHESS_TOKEN is not set; community broadcasts are off',
    );
  }
  const window = broadcastWindow(published);
  return {
    queued: queued.length,
    ready: actions.filter(({ action }) => action === 'use').length,
    community:
      community === null || window === null
        ? 'off'
        : community.nightly(window, now),
  };
}
