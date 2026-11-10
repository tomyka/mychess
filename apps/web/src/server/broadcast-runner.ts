/**
 * Builds the broadcast index of the months searches need (#316, spec
 * decisions 2 and 3, security requirements of task 4), in the background
 * of this server process.
 *
 * One month at a time per process (the Lichess database site asks for one
 * request at a time); the database's row lock decides between processes.
 * A month is claimed, its dump streamed through the header parser into one
 * write transaction under one AbortSignal: a 10-minute deadline, below the
 * domain's 15-minute stale window, and a 60-second limit on waiting for
 * bytes. On any error or abort the attempt is recorded as failed, in its
 * own transaction; never after the write said the claim was lost, as the
 * month is then another process's. The dump is always closed.
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
import type { BroadcastMonth } from '@mychess/domain';
import { z } from 'zod';
import {
  broadcastGames,
  openBroadcastDump,
  type Fetch,
} from '@mychess/integrations';

/** The time limits of one month's processing. */
export interface RunnerLimits {
  /** The whole month: download, decompression and write. */
  readonly deadlineMs: number;
  /** The longest wait for the download's next bytes. */
  readonly idleMs: number;
}

/** The limits of the security requirements, task 4. */
export const RUNNER_LIMITS: RunnerLimits = {
  deadlineMs: 10 * 60_000,
  idleMs: 60_000,
};

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

export interface BroadcastRunnerDeps {
  readonly index: BroadcastIndex;
  readonly fetch: Fetch;
  readonly clock: () => Date;
  readonly limits?: RunnerLimits;
}

export interface BroadcastRunner {
  /**
   * Queues `months` to be processed, each once while queued, and starts
   * the runner when it is idle. Returns at once: a search never waits.
   */
  need(months: readonly BroadcastMonth[]): void;
  /** Resolves once the queue is empty and nothing is processing. */
  settled(): Promise<void>;
}

/**
 * A runner with an empty queue. Its creation is taken as its process's
 * start (there is one runner per process, fide-services.ts): before its
 * first claim it releases, once, the months a process before it left
 * processing (#355), so a restart does not cost those months an attempt.
 */
export function createBroadcastRunner(
  deps: BroadcastRunnerDeps,
): BroadcastRunner {
  const startedAt = deps.clock();
  const queue = new Set<BroadcastMonth>();
  let running: Promise<void> | undefined;
  let released: Promise<void> | undefined;

  const drain = async (): Promise<void> => {
    released ??= releaseSafely(deps.index, startedAt);
    await released;
    for (let month = first(queue); month !== undefined; month = first(queue)) {
      // Left queued while it is processed, so needing it again meanwhile
      // does not queue it twice.
      await processSafely(deps, month);
      queue.delete(month);
    }
    // Set in the same turn as the queue was found empty, so a month queued
    // after this starts a new drain.
    running = undefined;
  };

  return {
    need(months) {
      for (const month of months) queue.add(month);
      if (running === undefined && queue.size > 0) running = drain();
    },
    settled: () => running ?? Promise.resolve(),
  };
}

function first(queue: ReadonlySet<BroadcastMonth>): BroadcastMonth | undefined {
  return queue.values().next().value;
}

/**
 * Releases the months interrupted before `startedAt`. A failure is logged
 * by the error's name alone and the runner goes on: the 15-minute stale
 * rule still hands those months back, at the cost of an attempt.
 */
async function releaseSafely(
  index: BroadcastIndex,
  startedAt: Date,
): Promise<void> {
  try {
    await index.release(startedAt);
  } catch (error) {
    console.error(
      'broadcast index: release failed',
      error instanceof Error ? error.name : 'unknown error',
    );
  }
}

/** Processes `month`; any failure is logged, so the queue goes on. */
async function processSafely(
  deps: BroadcastRunnerDeps,
  month: BroadcastMonth,
): Promise<void> {
  try {
    await processMonth(deps, month);
  } catch (error) {
    console.error(`fide: broadcast month ${month} failed`, logText(error));
  }
}

async function processMonth(
  deps: BroadcastRunnerDeps,
  month: BroadcastMonth,
): Promise<void> {
  const claimed = await deps.index.claim(month, deps.clock());
  // Refused: another process holds the month, or it needs nothing now.
  if (!claimed.ok) return;
  try {
    await indexMonth(deps, claimed.value);
  } catch (error) {
    await deps.index.fail(claimed.value, deps.clock());
    throw error;
  }
}

/**
 * Streams the claimed month's dump into its write. A write refused because
 * the claim was lost returns without reading; the dump is closed either way.
 */
async function indexMonth(
  deps: BroadcastRunnerDeps,
  claim: BroadcastMonthClaim,
): Promise<void> {
  const limits = deps.limits ?? RUNNER_LIMITS;
  const controller = new AbortController();
  const deadline = setTimeout(() => {
    controller.abort(new Error(`over ${String(limits.deadlineMs)} ms`));
  }, limits.deadlineMs);
  const idle = new IdleLimit(controller, limits.idleMs);
  try {
    idle.arm();
    await using dump = await openBroadcastDump(
      deps.fetch,
      claim.month,
      controller.signal,
    );
    idle.disarm();
    await deps.index.write({
      claim,
      games: broadcastGames(idle.watch(dump.text)),
      clock: deps.clock,
    });
  } finally {
    clearTimeout(deadline);
    idle.disarm();
  }
}

/**
 * Aborts `controller` when the download keeps the runner waiting longer
 * than `ms`: counted only while it waits for bytes, not while the write
 * holds a chunk, so a slow insert is not taken for a stalled download.
 */
class IdleLimit {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly controller: AbortController;
  private readonly ms: number;

  constructor(controller: AbortController, ms: number) {
    this.controller = controller;
    this.ms = ms;
  }

  arm(): void {
    this.disarm();
    this.timer = setTimeout(() => {
      this.controller.abort(new Error(`no bytes for ${String(this.ms)} ms`));
    }, this.ms);
  }

  disarm(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  async *watch(text: AsyncIterable<string>): AsyncGenerator<string> {
    const iterator = text[Symbol.asyncIterator]();
    try {
      for (;;) {
        this.arm();
        const next = await iterator.next();
        this.disarm();
        if (next.done === true) return;
        yield next.value;
      }
    } finally {
      this.disarm();
      await iterator.return?.();
    }
  }
}

/** The most characters of a failed query's cause a log line keeps. */
const CAUSE_CHARS = 200;

/**
 * A failed Drizzle query (DrizzleQueryError): its message holds the query
 * and its parameters, so only its cause, the driver's error, is logged.
 */
const failedQuerySchema = z.object({
  query: z.string(),
  params: z.array(z.unknown()),
  cause: z.instanceof(Error),
});

/**
 * What the log says of `error` (security L1): its name, and for a failed
 * query its cause's message, capped; never an error's own message, which
 * may hold game data or query parameters.
 */
function logText(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown error';
  const query = failedQuerySchema.safeParse(error);
  if (!query.success) return error.name;
  const { cause } = query.data;
  return `${error.name}: ${cause.message.slice(0, CAUSE_CHARS)}`;
}
