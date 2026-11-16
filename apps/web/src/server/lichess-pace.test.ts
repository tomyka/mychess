import { getEventListeners } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createLichessPacer,
  LICHESS_PACE,
  NO_ABORT,
  sleep,
  type LichessLane,
} from './lichess-pace';

const T0 = Date.UTC(2026, 10, 16, 3);

/** A fake Lichess: what each call answers, and when each one started. */
function lichess() {
  const started: { url: string; at: number; init: RequestInit }[] = [];
  const answers = new Map<string, () => Promise<Response>>();
  const fetch = (url: string, init: RequestInit): Promise<Response> => {
    started.push({ url, at: Date.now() - T0, init });
    const answer = answers.get(url);
    if (answer !== undefined) return answer();
    return Promise.resolve(new Response(url));
  };
  return { fetch, started, answers };
}

/** A request that never answers, until its signal aborts. */
const hang = (init: () => RequestInit) => (): Promise<Response> =>
  new Promise((_, reject) => {
    const signal = init().signal;
    signal?.addEventListener('abort', () => {
      reject(new Error('aborted'));
    });
  });

/** A timeout on the fake clock, as AbortSignal.timeout is on the real one. */
function fakeTimeout(ms: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => {
    controller.abort(new Error(`timed out after ${String(ms)} ms`));
  }, ms);
  return controller.signal;
}

function pacer(server: ReturnType<typeof lichess>) {
  const paced = createLichessPacer(server.fetch, {
    ...LICHESS_PACE,
    sleep,
    clock: () => Date.now(),
    timeout: fakeTimeout,
  });
  return (lane: LichessLane, url: string, init: RequestInit = {}) =>
    paced.fetch(lane)(url, init);
}

beforeEach(() => {
  vi.useFakeTimers({ now: T0 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the Lichess pacer (#349, spec decision 3)', () => {
  it('keeps a second between requests, a minute after a 429, 15 seconds a request', () => {
    expect(LICHESS_PACE).toEqual({
      gapMs: 1000,
      pauseMs: 60_000,
      requestMs: 15_000,
    });
  });

  it('sends one request at a time, each a second after the one before started', async () => {
    const server = lichess();
    const call = pacer(server);
    const answers = [
      call('night', 'a'),
      call('night', 'b'),
      call('night', 'c'),
    ];
    await vi.runAllTimersAsync();
    expect(
      await Promise.all(answers.map(async (a) => (await a).text())),
    ).toEqual(['a', 'b', 'c']);
    expect(server.started.map(({ url, at }) => [url, at])).toEqual([
      ['a', 0],
      ['b', 1000],
      ['c', 2000],
    ]);
  });

  it('does not wait when the gap has passed already', async () => {
    const server = lichess();
    const call = pacer(server);
    await call('night', 'a');
    await vi.advanceTimersByTimeAsync(5000);
    await call('night', 'b');
    expect(server.started.map(({ at }) => at)).toEqual([0, 5000]);
  });

  it('holds every lane for a minute after a 429 (architect M1)', async () => {
    const server = lichess();
    server.answers.set('a', () =>
      Promise.resolve(new Response(null, { status: 429 })),
    );
    const call = pacer(server);
    const first = call('night', 'a');
    const next = [call('night', 'b'), call('download', 'c')];
    await vi.advanceTimersByTimeAsync(59_999);
    expect((await first).status).toBe(429);
    expect(server.started).toHaveLength(1);
    await vi.runAllTimersAsync();
    await Promise.all(next);
    expect(server.started.map(({ url, at }) => [url, at])).toEqual([
      ['a', 0],
      ['b', 60_000],
      ['c', 61_000],
    ]);
  });

  it('sends the calls of every lane in the order they joined', async () => {
    const server = lichess();
    const call = pacer(server);
    const all = [
      call('night', 'n1'),
      call('download', 'd1'),
      call('night', 'n2'),
    ];
    await vi.runAllTimersAsync();
    await Promise.all(all);
    expect(server.started.map(({ url }) => url)).toEqual(['n1', 'd1', 'n2']);
  });

  it('rejects a call aborted while queued at once, without its turn (security M1a)', async () => {
    const server = lichess();
    const call = pacer(server);
    const controller = new AbortController();
    const first = call('night', 'a');
    const aborted = call('night', 'b', { signal: controller.signal });
    const after = call('night', 'c');
    controller.abort(new Error('the user left'));
    await expect(aborted).rejects.toThrow('the user left');
    await vi.runAllTimersAsync();
    await Promise.all([first, after]);
    // c takes the turn b would have had: b moved nothing on.
    expect(server.started.map(({ url, at }) => [url, at])).toEqual([
      ['a', 0],
      ['c', 1000],
    ]);
  });

  it('rejects a call aborted during the wait for its turn, without sending it', async () => {
    const server = lichess();
    const call = pacer(server);
    const controller = new AbortController();
    await call('night', 'a');
    const aborted = call('night', 'b', { signal: controller.signal });
    const settled = aborted.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(500);
    controller.abort(new Error('shut down'));
    await vi.advanceTimersByTimeAsync(500);
    expect(await settled).toEqual(new Error('shut down'));
    const after = call('night', 'c');
    await vi.runAllTimersAsync();
    await after;
    expect(server.started.map(({ url, at }) => [url, at])).toEqual([
      ['a', 0],
      ['c', 1000],
    ]);
  });

  it('drops a queued call the moment its signal aborts, even during a 429 pause', async () => {
    const server = lichess();
    server.answers.set('a', () =>
      Promise.resolve(new Response(null, { status: 429 })),
    );
    const call = pacer(server);
    await call('night', 'a');
    const controller = new AbortController();
    const queued = call('night', 'b', { signal: controller.signal }).catch(
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(10_000);
    controller.abort(new Error('the caller gave up'));
    expect(await queued).toEqual(new Error('the caller gave up'));
    expect(Date.now() - T0).toBe(10_000);
    const after = call('night', 'c');
    await vi.runAllTimersAsync();
    await after;
    expect(server.started.map(({ url, at }) => [url, at])).toEqual([
      ['a', 0],
      ['c', 60_000],
    ]);
  });

  it('starts a call’s timeout at its turn, not while it waits in the queue (security M1c)', async () => {
    const server = lichess();
    server.answers.set('a', () =>
      Promise.resolve(new Response(null, { status: 429 })),
    );
    const call = pacer(server);
    void call('night', 'a');
    const waited = call('night', 'b');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await waited).toBeInstanceOf(Response);
    expect(server.started.map(({ url, at }) => [url, at])).toEqual([
      ['a', 0],
      ['b', 60_000],
    ]);
  });

  it.each(['night'] as const)(
    'gives a %s call 15 seconds from its turn, whatever its own signal',
    async (lane) => {
      const server = lichess();
      server.answers.set(
        'slow',
        hang(() => server.started.at(-1)?.init ?? {}),
      );
      const call = pacer(server);
      const slow = call(lane, 'slow', { signal: NO_ABORT });
      const settled = slow.catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(14_999);
      expect(server.started).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(await settled).toEqual(new Error('aborted'));
    },
  );

  it('calls a lane’s onTurn as each request is sent, never for one rejected while it waited', async () => {
    const server = lichess();
    const paced = createLichessPacer(server.fetch, {
      ...LICHESS_PACE,
      sleep,
      clock: () => Date.now(),
      timeout: fakeTimeout,
    });
    const turns: [string, number][] = [];
    const onTurn = (name: string) => () => {
      turns.push([name, Date.now() - T0]);
      expect(server.started.map(({ url }) => url)).not.toContain(name);
    };
    const controller = new AbortController();
    const first = paced.fetch('download', onTurn('a'))('a', {});
    const dropped = paced
      .fetch('download', onTurn('b'))('b', { signal: controller.signal })
      .catch(() => undefined);
    const third = paced.fetch('download', onTurn('c'))('c', {});
    controller.abort();
    await vi.runAllTimersAsync();
    await Promise.all([first, dropped, third]);
    expect(turns).toEqual([
      ['a', 0],
      ['c', 1000],
    ]);
  });

  it('sends a call with NO_ABORT on its timeout alone, never combined with it (security nit)', async () => {
    const server = lichess();
    const timeouts: AbortSignal[] = [];
    const paced = createLichessPacer(server.fetch, {
      ...LICHESS_PACE,
      sleep,
      clock: () => Date.now(),
      timeout: (ms) => {
        const signal = fakeTimeout(ms);
        timeouts.push(signal);
        return signal;
      },
    });
    await paced.fetch('night')('a', { signal: NO_ABORT });
    const own = new AbortController().signal;
    const second = paced.fetch('night')('b', { signal: own });
    await vi.runAllTimersAsync();
    await second;
    expect(timeouts).toHaveLength(2);
    expect(server.started[0]?.init.signal).toBe(timeouts[0]);
    // A real signal is still combined with the timeout.
    const combined = server.started[1]?.init.signal;
    expect(combined).not.toBe(timeouts[1]);
    expect(combined).not.toBe(own);
    // It follows its timeout, which the fake clock has run out by now.
    expect(timeouts[1]?.aborted).toBe(true);
    expect(combined?.aborted).toBe(true);
  });

  it('leaves a download to its own signal: the runner bounds it', async () => {
    const server = lichess();
    const call = pacer(server);
    const own = new AbortController().signal;
    await call('download', 'pgn', { signal: own });
    expect(server.started[0]?.init.signal).toBe(own);
  });

  it('passes the request on with its headers', async () => {
    const server = lichess();
    const call = pacer(server);
    const headers = { Authorization: 'Bearer x' };
    await call('night', 'https://lichess.org/api/broadcast/abcdefgh', {
      headers,
    });
    expect(server.started[0]?.url).toBe(
      'https://lichess.org/api/broadcast/abcdefgh',
    );
    expect(server.started[0]?.init.headers).toBe(headers);
  });

  it('goes on after a request that failed', async () => {
    const server = lichess();
    server.answers.set('a', () => Promise.reject(new Error('network down')));
    const call = pacer(server);
    const failed = call('night', 'a').catch((error: unknown) => error);
    const next = call('night', 'b');
    await vi.runAllTimersAsync();
    expect(await failed).toEqual(new Error('network down'));
    expect(await (await next).text()).toBe('b');
  });
});

describe('the pacer’s abort listeners (security nit)', () => {
  const listeners = (signal: AbortSignal): number =>
    getEventListeners(signal, 'abort').length;

  it('never leaves one on NO_ABORT, however many calls pass it', async () => {
    const server = lichess();
    const call = pacer(server);
    const calls = Array.from({ length: 50 }, (_, n) =>
      call(n % 2 === 0 ? 'night' : 'download', String(n), {
        signal: NO_ABORT,
      }),
    );
    expect(listeners(NO_ABORT)).toBe(0);
    await vi.runAllTimersAsync();
    await Promise.all(calls);
    expect(listeners(NO_ABORT)).toBe(0);
  });

  it('removes a queued call’s listener once it is sent, aborted or dropped as already aborted', async () => {
    const server = lichess();
    const call = pacer(server);
    const sent = new AbortController();
    const aborted = new AbortController();
    const early = new AbortController();
    early.abort();
    const all = [
      call('night', 'a'),
      call('night', 'b', { signal: sent.signal }),
      call('night', 'c', { signal: aborted.signal }).catch(() => undefined),
      call('night', 'd', { signal: early.signal }).catch(() => undefined),
    ];
    expect(listeners(sent.signal)).toBe(1);
    expect(listeners(aborted.signal)).toBe(1);
    expect(listeners(early.signal)).toBe(0);
    aborted.abort();
    await vi.runAllTimersAsync();
    await Promise.all(all);
    expect(server.started.map(({ url }) => url)).toEqual(['a', 'b']);
    expect(listeners(sent.signal)).toBe(0);
    expect(listeners(aborted.signal)).toBe(0);
  });
});

describe('sleep', () => {
  it('waits the time asked', async () => {
    let woke = false;
    const done = sleep(1000).then(() => {
      woke = true;
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(woke).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(woke).toBe(true);
  });
});

describe('NO_ABORT', () => {
  it('never aborts', () => {
    expect(NO_ABORT.aborted).toBe(false);
  });
});
