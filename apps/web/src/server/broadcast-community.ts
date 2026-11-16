/**
 * The community broadcast side of the index (#349), one per process
 * (fide-services.ts), present only with a Lichess token: the nightly run
 * (spec decision 3) and the adding of a pasted tournament (decision 4).
 *
 * A night lists the approved organisers (broadcast-organisers.ts), then
 * hands the runner every queued tournament in the window the domain says
 * to process: new ones, and those whose failed attempt may be retried.
 * One night runs at a time; the nightly route does not wait for it, as a
 * 429 alone makes it wait a minute.
 */
import type { BroadcastTourEntry } from '@mychess/db';
import {
  nextBroadcastTourAction,
  type BroadcastWindow,
  type QueuedBroadcastTour,
} from '@mychess/domain';
import type { LichessApi } from '@mychess/integrations';
import { listOrganiserTours } from './broadcast-organisers';
import type { BroadcastRunner } from './broadcast-runner';

export interface CommunityBroadcastsDeps {
  /** The pacer's night lane: the organiser listing. */
  readonly api: LichessApi;
  /** The pacer's paste lane, behind every night and download call. */
  readonly pasteApi: LichessApi;
  readonly runner: Pick<BroadcastRunner, 'needTours'>;
  /** Queues a tournament; true when it was new to the index. */
  readonly queue: (tour: QueuedBroadcastTour) => Promise<boolean>;
  /** The queued tournaments of `window` with their states. */
  readonly statuses: (window: BroadcastWindow) => Promise<BroadcastTourEntry[]>;
}

export interface CommunityBroadcasts {
  /** What a pasted link's Lichess calls go through: the paste lane. */
  readonly pasteApi: LichessApi;
  /** Starts tonight's run, unawaited, unless one is running already. */
  nightly(window: BroadcastWindow, now: Date): 'started' | 'running';
  /** Queues `tour` and, when it was new, hands it to the runner. */
  add(tour: QueuedBroadcastTour): Promise<boolean>;
  /** Resolves once no night is running. */
  settled(): Promise<void>;
}

export function createCommunityBroadcasts(
  deps: CommunityBroadcastsDeps,
): CommunityBroadcasts {
  let night: Promise<void> | undefined;
  return {
    pasteApi: deps.pasteApi,
    nightly(window, now) {
      if (night !== undefined) return 'running';
      night = runSafely(deps, window, now).finally(() => {
        night = undefined;
      });
      return 'started';
    },
    async add(tour) {
      const added = await deps.queue(tour);
      if (added) deps.runner.needTours([tour.id]);
      return added;
    },
    settled: () => night ?? Promise.resolve(),
  };
}

/** One night; a failure is logged by its error name alone. */
async function runSafely(
  deps: CommunityBroadcastsDeps,
  window: BroadcastWindow,
  now: Date,
): Promise<void> {
  try {
    await runNight(deps, window, now);
  } catch (error) {
    console.error(
      'fide: community broadcasts night failed',
      error instanceof Error ? error.name : 'unknown error',
    );
  }
}

async function runNight(
  deps: CommunityBroadcastsDeps,
  window: BroadcastWindow,
  now: Date,
): Promise<void> {
  await listOrganiserTours(deps, window, now);
  const due = (await deps.statuses(window))
    .filter(({ status }) => nextBroadcastTourAction(status, now) === 'process')
    .map(({ tourId }) => tourId);
  deps.runner.needTours(due);
}
