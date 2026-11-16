/**
 * What the broadcast runner holds every download to, a dump month's or a
 * tournament's PGN (#316 security requirements, task 4; #349): a deadline
 * for the whole download and its write, below the domain's 15-minute stale
 * window, and a limit on waiting for the next bytes. And what its log
 * lines may say of an error.
 */
import { z } from 'zod';

/** The time limits of one download and its write. */
export interface RunnerLimits {
  /** The whole download: transfer, decompression and write. */
  readonly deadlineMs: number;
  /** The longest wait for the download's next bytes. */
  readonly idleMs: number;
}

/** The limits of the security requirements, task 4. */
export const RUNNER_LIMITS: RunnerLimits = {
  deadlineMs: 10 * 60_000,
  idleMs: 60_000,
};

/**
 * Runs `download` under `limits`: its signal is aborted at the deadline,
 * or when `idle` is left armed longer than the idle limit. The idle limit
 * starts armed, for the wait for the download's answer, unless
 * `armIdle` is false: a download that waits its turn in a queue first
 * arms it when its request is sent, so the wait never counts as idle. The
 * deadline runs from the start either way.
 */
export async function withDownloadLimits<T>(
  limits: RunnerLimits,
  download: (signal: AbortSignal, idle: IdleLimit) => Promise<T>,
  armIdle = true,
): Promise<T> {
  const controller = new AbortController();
  const deadline = setTimeout(() => {
    controller.abort(new Error(`over ${String(limits.deadlineMs)} ms`));
  }, limits.deadlineMs);
  const idle = new IdleLimit(controller, limits.idleMs);
  try {
    if (armIdle) idle.arm();
    return await download(controller.signal, idle);
  } finally {
    clearTimeout(deadline);
    idle.disarm();
  }
}

/**
 * Aborts `controller` when the download keeps the runner waiting longer
 * than `ms`: counted only while it waits for the next item, not while the
 * write holds one, so a slow insert is not taken for a stalled download.
 */
export class IdleLimit {
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

  async *watch<T>(items: AsyncIterable<T>): AsyncGenerator<T> {
    const iterator = items[Symbol.asyncIterator]();
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
export function logText(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown error';
  const query = failedQuerySchema.safeParse(error);
  if (!query.success) return error.name;
  const { cause } = query.data;
  return `${error.name}: ${cause.message.slice(0, CAUSE_CHARS)}`;
}
