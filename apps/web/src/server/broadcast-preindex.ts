import 'server-only';
/**
 * The nightly upkeep of the broadcast index (#354, R-195; #349 spec
 * decision 3), built with its dependencies by the services
 * (fide-services.ts): of the 12 newest published months, every one the
 * domain says to process is handed to this process's runner, unawaited,
 * so a search finds it ready. The runner is single-flight and claims each
 * month under a row lock, so a run overlapping a search or another run
 * downloads nothing twice.
 *
 * First it prunes the index to the window of a full, current month list
 * (#344, broadcastPruneWindow): the months and tournaments that left it
 * go, with their games. A list shorter than 12 months, newer than now or
 * stale prunes nothing; a failed prune is logged and the upkeep goes on.
 *
 * With a Lichess token it also starts the community broadcasts' night,
 * unawaited (broadcast-community.ts): the approved organisers are listed
 * and the tournaments due are handed to the same runner. Without one that
 * part is off, said once a night in the log; the months go on as before.
 */
import type { BroadcastMonthEntry, BroadcastPruneCount } from '@mychess/db';
import {
  broadcastPruneWindow,
  broadcastWindow,
  nextBroadcastMonthAction,
  searchMonths,
  type BroadcastMonth,
  type BroadcastWindow,
} from '@mychess/domain';
import type { CommunityBroadcasts } from './broadcast-community';
import type { BroadcastRunner } from './broadcast-runner';
import { logText } from './log-text';

/**
 * How many of the newest months were handed to the runner, and are ready;
 * and whether the community broadcasts' night was started, was running
 * already, or is off; and what the prune deleted, null when it did not run
 * or failed.
 */
export interface PreindexCounts {
  readonly queued: number;
  readonly ready: number;
  readonly community: 'started' | 'running' | 'off';
  readonly pruned: BroadcastPruneCount | null;
}

export interface PreindexDeps {
  /**
   * The published dump months, read in this run (BroadcastSources
   * .refreshMonths): the prune goes by them, never by a cached list.
   */
  readonly months: () => Promise<readonly BroadcastMonth[]>;
  /** The months' index states (broadcastMonthStatuses). */
  readonly monthStatuses: (
    months: readonly BroadcastMonth[],
  ) => Promise<BroadcastMonthEntry[]>;
  readonly runner: Pick<BroadcastRunner, 'need'>;
  /** None without a Lichess token. */
  readonly community: Pick<CommunityBroadcasts, 'nightly'> | null;
  /** Deletes what left `window` (pruneBroadcastIndex). */
  readonly prune: (window: BroadcastWindow) => Promise<BroadcastPruneCount>;
}

/**
 * Hands the months still to index at `now` to the runner and starts the
 * community night; fails when the month list or their statuses cannot be
 * read.
 */
export type Preindex = (now: Date) => Promise<PreindexCounts>;

/** The nightly upkeep over `deps`. */
export function createPreindex(deps: PreindexDeps): Preindex {
  return async (now) => {
    const published = await deps.months();
    const pruned = await pruneSafely(deps.prune, published, now);
    const actions = (await deps.monthStatuses(searchMonths(published))).map(
      ({ month, status }) => ({
        month,
        action: nextBroadcastMonthAction(status, now),
      }),
    );
    const queued = actions
      .filter(({ action }) => action === 'process')
      .map(({ month }) => month);
    deps.runner.need(queued);
    return {
      queued: queued.length,
      ready: actions.filter(({ action }) => action === 'use').length,
      community: startNight(deps.community, published, now),
      pruned,
    };
  };
}

/** Starts the community night over the window of `published`, if on. */
function startNight(
  community: PreindexDeps['community'],
  published: readonly BroadcastMonth[],
  now: Date,
): PreindexCounts['community'] {
  if (community === null) {
    console.warn(
      'fide: LICHESS_TOKEN is not set; community broadcasts are off',
    );
    return 'off';
  }
  const window = broadcastWindow(published);
  return window === null ? 'off' : community.nightly(window, now);
}

/**
 * Prunes to the window of `published` when the domain says it is safe at
 * `now` (a full, current list: broadcastPruneWindow); what
 * went, logged when anything did, or null when nothing ran or it failed.
 */
async function pruneSafely(
  prune: PreindexDeps['prune'],
  published: readonly BroadcastMonth[],
  now: Date,
): Promise<BroadcastPruneCount | null> {
  const window = broadcastPruneWindow(published, now);
  if (window === null) return null;
  try {
    const pruned = await prune(window);
    if (pruned.months + pruned.tours > 0) {
      console.warn(
        'fide: broadcast index pruned',
        `${String(pruned.months)} months, ${String(pruned.tours)} tours`,
      );
    }
    return pruned;
  } catch (error) {
    console.error('fide: broadcast index prune failed', logText(error));
    return null;
  }
}
