/**
 * What the broadcast runner holds every download to, a dump month's or a
 * tournament's PGN (#316 security requirements, task 4; #349): a deadline
 * for the whole download and its write, below the domain's 15-minute stale
 * window, and a limit on waiting for the next bytes.
 */
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
 * from the start, or when `idle` is left armed longer than the idle
 * limit. The idle limit starts disarmed: whoever sends the download's
 * request arms it then, so a wait for a turn in a queue never counts as
 * idle (the dump month as it fetches, the Lichess gateway as the PGN's
 * turn comes).
 */
export async function withDownloadLimits<T>(
  limits: RunnerLimits,
  download: (signal: AbortSignal, idle: IdleLimit) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const deadline = setTimeout(() => {
    controller.abort(new Error(`over ${String(limits.deadlineMs)} ms`));
  }, limits.deadlineMs);
  const idle = new IdleLimit(controller, limits.idleMs);
  try {
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
