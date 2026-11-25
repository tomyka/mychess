import 'server-only';
/**
 * Builds the broadcast index of the months searches need (#316, spec
 * decisions 2 and 3, security requirements of task 4) and fetches the
 * queued broadcast tournaments (#349, spec decision 1), in the background
 * of this server process.
 *
 * One download at a time per process, a month's or a tournament's: they
 * share one queue (the Lichess sites ask for one request at a time); the
 * database's row lock decides between processes. A month is claimed, its
 * dump streamed through the header parser into one write transaction
 * under the download limits (broadcast-limits.ts). On any error or abort
 * the attempt is recorded as failed, in its own transaction; never after
 * the write said the claim was lost, as the month is then another
 * process's. The dump is always closed. A tournament's job is
 * broadcast-tour-job.ts; without a Lichess token the runner has none.
 *
 * The runner never learns which FIDE ID a search was for, so nothing it
 * logs can name one.
 */
import {
  claimBroadcastMonth,
  failBroadcastMonth,
  releaseInterruptedBroadcastMonths,
  writeBroadcastMonth,
  type BroadcastMonthClaim,
  type BroadcastMonthWrite,
  type Executor,
} from '@mychess/db';
import type { BroadcastMonth, BroadcastTourId } from '@mychess/domain';
import {
  broadcastGames,
  openBroadcastDump,
  type Fetch,
} from '@mychess/integrations';
import {
  RUNNER_LIMITS,
  withDownloadLimits,
  type RunnerLimits,
} from './broadcast-limits';
import { processTour, type BroadcastTourIndex } from './broadcast-tour-job';
import type { LichessBroadcasts } from './lichess-broadcasts';
import { logText } from './log-text';

/** The index repositories the runner uses, on one database. */
export interface BroadcastIndex {
  claim: (
    month: BroadcastMonth,
    now: Date,
  ) => ReturnType<typeof claimBroadcastMonth>;
  write: (write: BroadcastMonthWrite) => ReturnType<typeof writeBroadcastMonth>;
  fail: (
    claim: BroadcastMonthClaim,
    now: Date,
  ) => ReturnType<typeof failBroadcastMonth>;
  release: (
    processStartedAt: Date,
  ) => ReturnType<typeof releaseInterruptedBroadcastMonths>;
}

/** The index repositories on `db`. The write keeps its default idle backstop. */
export function broadcastIndexOn(db: Executor): BroadcastIndex {
  return {
    claim: (month, now) => claimBroadcastMonth(db, month, now),
    write: (write) => writeBroadcastMonth(db, write),
    fail: (claim, now) => failBroadcastMonth(db, claim, now),
    release: (processStartedAt) =>
      releaseInterruptedBroadcastMonths(db, processStartedAt),
  };
}

/** What the runner fetches tournaments with: their repositories, and Lichess. */
interface BroadcastTourSide {
  readonly index: BroadcastTourIndex;
  readonly broadcasts: Pick<LichessBroadcasts, 'tour' | 'openPgn'>;
}

export interface BroadcastRunnerDeps {
  readonly index: BroadcastIndex;
  readonly fetch: Fetch;
  readonly clock: () => Date;
  readonly limits?: RunnerLimits;
  /** None without a Lichess token: tournaments needed are then ignored. */
  readonly tours?: BroadcastTourSide | null;
}

export interface BroadcastRunner {
  /**
   * Queues `months` to be processed, each once while queued, and starts
   * the runner when it is idle. Returns at once: a search never waits.
   */
  need(months: readonly BroadcastMonth[]): void;
  /** Queues `tourIds` to be fetched, as `need` queues months. */
  needTours(tourIds: readonly BroadcastTourId[]): void;
  /** Resolves once the queue is empty and nothing is processing. */
  settled(): Promise<void>;
}

/** A queued download: what its log line names, and the work. */
interface Job {
  readonly name: string;
  readonly run: () => Promise<void>;
}

/**
 * A runner with an empty queue. Its creation is taken as its process's
 * start (there is one runner per process, fide-services.ts): before its
 * first claim it releases, once, the months and tournaments a process
 * before it left processing (#355), so a restart does not cost them an
 * attempt.
 */
export function createBroadcastRunner(
  deps: BroadcastRunnerDeps,
): BroadcastRunner {
  const startedAt = deps.clock();
  const limits = deps.limits ?? RUNNER_LIMITS;
  const tours = deps.tours ?? null;
  // Keyed `month:` or `tour:`, so each is queued once.
  const queue = new Map<string, Job>();
  let running: Promise<void> | undefined;
  let released: Promise<void> | undefined;

  const drain = async (): Promise<void> => {
    released ??= releaseAll(deps.index, tours, startedAt);
    await released;
    for (let next = first(queue); next !== undefined; next = first(queue)) {
      // Left queued while it is processed, so needing it again meanwhile
      // does not queue it twice.
      const [key, job] = next;
      await runSafely(job);
      queue.delete(key);
    }
    // Set in the same turn as the queue was found empty, so a job queued
    // after this starts a new drain.
    running = undefined;
  };
  const enqueue = (key: string, job: Job): void => {
    if (!queue.has(key)) queue.set(key, job);
  };
  const start = (): void => {
    if (running === undefined && queue.size > 0) running = drain();
  };

  return {
    need(months) {
      for (const month of months) {
        enqueue(`month:${month}`, {
          name: `broadcast month ${month}`,
          run: () => processMonth(deps, limits, month),
        });
      }
      start();
    },
    needTours(tourIds) {
      if (tours === null) return;
      for (const tourId of tourIds) {
        enqueue(`tour:${tourId}`, {
          name: `broadcast tour ${tourId}`,
          run: () =>
            processTour({ ...tours, clock: deps.clock, limits }, tourId),
        });
      }
      start();
    },
    settled: () => running ?? Promise.resolve(),
  };
}

function first(queue: ReadonlyMap<string, Job>): [string, Job] | undefined {
  return queue.entries().next().value;
}

/** Releases the months, and the tournaments when there are any. */
async function releaseAll(
  index: BroadcastIndex,
  tours: BroadcastTourSide | null,
  startedAt: Date,
): Promise<void> {
  await releaseSafely(() => index.release(startedAt));
  if (tours !== null) {
    await releaseSafely(() => tours.index.release(startedAt));
  }
}

/**
 * Releases what a process before this one left processing. A failure is
 * logged as logText says (log-text.ts) and the runner goes on: the 15-minute
 * stale rule still hands it back, at the cost of an attempt.
 */
async function releaseSafely(release: () => Promise<number>): Promise<void> {
  try {
    await release();
  } catch (error) {
    console.error('fide: broadcast index release failed', logText(error));
  }
}

/** Runs `job`; any failure is logged, so the queue goes on. */
async function runSafely(job: Job): Promise<void> {
  try {
    await job.run();
  } catch (error) {
    console.error(`fide: ${job.name} failed`, logText(error));
  }
}

async function processMonth(
  deps: BroadcastRunnerDeps,
  limits: RunnerLimits,
  month: BroadcastMonth,
): Promise<void> {
  const claimed = await deps.index.claim(month, deps.clock());
  // Refused: another process holds the month, or it needs nothing now.
  if (!claimed.ok) return;
  try {
    await indexMonth(deps, limits, claimed.value);
  } catch (error) {
    await deps.index.fail(claimed.value, deps.clock());
    throw error;
  }
}

/**
 * Streams the claimed month's dump into its write. A write refused because
 * the claim was lost returns without reading; the dump is closed either way.
 */
function indexMonth(
  deps: BroadcastRunnerDeps,
  limits: RunnerLimits,
  claim: BroadcastMonthClaim,
): Promise<void> {
  return withDownloadLimits(limits, async (signal, idle) => {
    // The dump is fetched at once: the wait for its answer is idle time.
    idle.arm();
    await using dump = await openBroadcastDump(deps.fetch, claim.month, signal);
    idle.disarm();
    await deps.index.write({
      claim,
      games: broadcastGames(idle.watch(dump.text)),
      clock: deps.clock,
    });
  });
}
