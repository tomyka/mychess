/**
 * The pace of this process's Lichess broadcast API requests (#349, spec
 * "Findings" and decision 3; architect M1, security M1): one at a time,
 * each started at least a second after the one before, and none for a
 * minute after a 429, whoever made the request that got it. The private
 * implementation of the Lichess broadcast gateway (lichess-broadcasts.ts),
 * which alone uses it; its calls go in the order they join, each in its
 * lane:
 *
 * - `night`: the organiser listing and a tournament's detail;
 * - `download`: a tournament's PGN, bounded by the runner's own limits.
 *
 * A `night` call gets LICHESS_PACE.requestMs from its turn, not
 * from when it joined the queue. A call whose signal aborts while it waits,
 * a 429 pause included, leaves the queue and is rejected at that moment,
 * without a turn. A request waits for the one before
 * it to answer, not for its body: a PGN streams on while the next request
 * goes out.
 */
import type { Fetch } from '@mychess/integrations';

/** The pacing rules (spec "Findings"). */
export const LICHESS_PACE = {
  /** The least time between the starts of two requests. */
  gapMs: 1000,
  /** How long Lichess asks to be left alone after a 429. */
  pauseMs: 60_000,
  /** How long a `night` call may take from its turn. */
  requestMs: 15_000,
} as const;

/** Who is asking: a call that is timed, or a download the runner bounds. */
export type LichessLane = 'night' | 'download';

/**
 * A signal that never aborts, for a call bounded by its lane alone: the
 * clients ask for one.
 */
export const NO_ABORT: AbortSignal = new AbortController().signal;

export interface PaceDeps {
  readonly gapMs: number;
  readonly pauseMs: number;
  readonly requestMs: number;
  readonly sleep: (ms: number) => Promise<void>;
  /** Milliseconds, as Date.now gives them. */
  readonly clock: () => number;
  /** A signal aborted `ms` from now; AbortSignal.timeout unless a test asks. */
  readonly timeout?: (ms: number) => AbortSignal;
}

export interface LichessPacer {
  /**
   * The fetch of `lane`, its requests queued with every other lane's;
   * `onTurn`, when given, is called as each request is sent, never for
   * one rejected while it waited.
   */
  fetch(lane: LichessLane, onTurn?: () => void): Fetch;
}

interface Call {
  readonly lane: LichessLane;
  readonly url: string;
  readonly init: RequestInit;
  readonly resolve: (response: Response) => void;
  readonly reject: (reason: unknown) => void;
  readonly onTurn: (() => void) | undefined;
  /** Stops watching the call's signal, once it is sent. */
  readonly release: () => void;
}

/** Whether a lane's calls carry the request timeout. */
const TIMED: Readonly<Record<LichessLane, boolean>> = {
  night: true,
  download: false,
};

/** A pacer over `fetch`, its queue empty. */
export function createLichessPacer(fetch: Fetch, deps: PaceDeps): LichessPacer {
  const queue: Call[] = [];
  let nextStart = Number.NEGATIVE_INFINITY;
  let pumping = false;
  const timeout = deps.timeout ?? ((ms: number) => AbortSignal.timeout(ms));

  const send = async (call: Call): Promise<void> => {
    nextStart = deps.clock() + deps.gapMs;
    call.release();
    call.onTurn?.();
    const init = TIMED[call.lane]
      ? {
          ...call.init,
          signal: withTimeout(call.init.signal, timeout(deps.requestMs)),
        }
      : call.init;
    try {
      const response = await fetch(call.url, init);
      if (response.status === 429) {
        nextStart = Math.max(nextStart, deps.clock() + deps.pauseMs);
      }
      call.resolve(response);
    } catch (error) {
      call.reject(error);
    }
  };

  const pump = async (): Promise<void> => {
    if (pumping) return;
    pumping = true;
    try {
      for (;;) {
        rejectAborted(queue);
        const wait = nextStart - deps.clock();
        if (queue.length === 0) return;
        // After the wait the queue is looked at afresh: a call may have
        // aborted.
        if (wait > 0) await deps.sleep(wait);
        else await sendNext();
      }
    } finally {
      pumping = false;
    }
  };

  const sendNext = async (): Promise<void> => {
    const call = queue.shift();
    if (call !== undefined) await send(call);
  };

  return {
    fetch: (lane, onTurn) => (url, init) =>
      new Promise<Response>((resolve, reject) => {
        join(queue, { lane, url, init, resolve, reject, onTurn });
        pump().catch(() => undefined);
      }),
  };
}

/**
 * Puts `fields` at the end of `queue`, watching its signal: an abort
 * while it waits takes it out at once; one aborted before it joined is
 * dropped at the next turn (rejectAborted). The listener goes on every
 * path: removed when the call is sent or dropped, and by `once` when it
 * fires.
 */
function join(queue: Call[], fields: Omit<Call, 'release'>): void {
  const signal = fields.init.signal ?? undefined;
  const leave = (): void => {
    const n = queue.indexOf(call);
    if (n === -1) return;
    queue.splice(n, 1);
    call.reject(signal?.reason);
  };
  const call: Call = {
    ...fields,
    release: () => {
      signal?.removeEventListener('abort', leave);
    },
  };
  // NO_ABORT never aborts and an aborted signal never fires again: neither
  // is watched, so no listener builds up on the process-long NO_ABORT.
  if (signal !== undefined && signal !== NO_ABORT && !signal.aborted) {
    signal.addEventListener('abort', leave, { once: true });
  }
  queue.push(call);
}

/**
 * The caller's signal and `timeout`, whichever aborts first; `timeout`
 * alone for no signal or NO_ABORT, which never aborts: combining with a
 * signal that lives as long as the process has leaked on some Node
 * versions.
 */
function withTimeout(
  signal: AbortSignal | null | undefined,
  timeout: AbortSignal,
): AbortSignal {
  return signal === null || signal === undefined || signal === NO_ABORT
    ? timeout
    : AbortSignal.any([signal, timeout]);
}

/** Rejects, with its abort reason, every call of `queue` whose signal aborted. */
function rejectAborted(queue: Call[]): void {
  for (let n = queue.length - 1; n >= 0; n -= 1) {
    const call = queue[n];
    const signal = call?.init.signal;
    if (call !== undefined && signal?.aborted === true) {
      queue.splice(n, 1);
      call.release();
      call.reject(signal.reason);
    }
  }
}

/** Waits `ms` milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
