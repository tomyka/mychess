import type { TrainingResult } from '@mychess/domain';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';
import {
  clearQueuedResults,
  enqueue,
  flush,
  FLUSH_BATCH,
  flushThenClear,
  pending,
  queueKey,
  SIGN_OUT_FLUSH_MS,
  type QueueStore,
} from './result-queue';

const REPERTOIRE = '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10';

/** A result as the drill makes it, the n-th of the session. */
const result = (n: number): TrainingResult => ({
  resultId: `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`,
  kind: 'pass',
  moveKey: `k${n.toString()}|d4`,
  repertoireId: REPERTOIRE,
  answeredAt: new Date(Date.UTC(2026, 9, 20, 8, 0, n)),
});

/** A store over one string, as localStorage keeps one key. */
function memoryStore(initial: string | null = null): QueueStore & {
  value: string | null;
} {
  const store = {
    value: initial,
    read: () => store.value,
    write: (value: string) => {
      store.value = value;
    },
  };
  return store;
}

const filled = (count: number): QueueStore => {
  const store = memoryStore();
  for (let n = 0; n < count; n += 1) enqueue(store, result(n));
  return store;
};

/** The server's 200: every result of the batch answered. */
const answering = (batch: readonly TrainingResult[]): Response =>
  Response.json({
    answers: batch.map(({ resultId }) => ({ resultId, status: 'applied' })),
  });

const ids = (results: readonly TrainingResult[]) =>
  results.map(({ resultId }) => resultId);

let errors: MockInstance<typeof console.error>;

beforeEach(() => {
  errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  return () => {
    errors.mockRestore();
  };
});

describe('queueKey', () => {
  it('is one key per account', () => {
    expect(queueKey('rokas')).toBe('mychess.results.rokas');
  });
});

describe('pending', () => {
  it('is empty with nothing stored', () => {
    expect(pending(memoryStore())).toEqual([]);
  });

  it('discards a stored value that is not a queue', () => {
    for (const garbage of [
      '{',
      'null',
      '{"a":1}',
      JSON.stringify([{ ...result(1), resultId: 'x' }]),
    ])
      expect(pending(memoryStore(garbage))).toEqual([]);
  });

  it('round-trips what was enqueued, in order and with its dates', () => {
    const store = memoryStore();
    enqueue(store, result(1));
    enqueue(store, result(2));
    expect(pending(store)).toEqual([result(1), result(2)]);
  });
});

describe('flush', () => {
  it('does not post an empty queue', async () => {
    const post = vi.fn<(batch: TrainingResult[]) => Promise<Response>>();
    expect(await flush(memoryStore(), post)).toEqual({ sent: 0, left: 0 });
    expect(post).not.toHaveBeenCalled();
  });

  it('empties the queue when every result is answered', async () => {
    const store = filled(3);
    const post = vi.fn((batch: TrainingResult[]) =>
      Promise.resolve(answering(batch)),
    );
    expect(await flush(store, post)).toEqual({ sent: 3, left: 0 });
    expect(post).toHaveBeenCalledExactlyOnceWith([
      result(0),
      result(1),
      result(2),
    ]);
    expect(pending(store)).toEqual([]);
  });

  it('removes only the results the server answered', async () => {
    const store = filled(3);
    const post = (batch: TrainingResult[]) =>
      Promise.resolve(answering(batch.slice(1)));
    expect(await flush(store, post)).toEqual({ sent: 2, left: 1 });
    expect(pending(store)).toEqual([result(0)]);
  });

  it('removes refused results too: they can never apply', async () => {
    const store = filled(1);
    const post = () =>
      Promise.resolve(
        Response.json({
          answers: [
            {
              resultId: result(0).resultId,
              status: 'refused',
              reason: 'training.notHeld',
            },
          ],
        }),
      );
    expect(await flush(store, post)).toEqual({ sent: 1, left: 0 });
  });

  it('keeps everything on a network error', async () => {
    const store = filled(2);
    const post = () => Promise.reject(new TypeError('Failed to fetch'));
    expect(await flush(store, post)).toEqual({ sent: 0, left: 2 });
    expect(pending(store)).toEqual([result(0), result(1)]);
  });

  it.each([503, 500, 429, 401])('keeps everything on a %i', async (status) => {
    const store = filled(2);
    const post = () => Promise.resolve(new Response(null, { status }));
    expect(await flush(store, post)).toEqual({ sent: 0, left: 2 });
    expect(pending(store)).toEqual([result(0), result(1)]);
    expect(errors).not.toHaveBeenCalled();
  });

  it('keeps everything on a 200 it cannot read', async () => {
    const store = filled(2);
    const post = () => Promise.resolve(new Response('<html>'));
    expect(await flush(store, post)).toEqual({ sent: 0, left: 2 });
  });

  it('drops the sent batch on a 400 and logs once, without the moves', async () => {
    const store = filled(FLUSH_BATCH + 1);
    const post = () =>
      Promise.resolve(
        Response.json({ reason: 'training.badBatch' }, { status: 400 }),
      );
    expect(await flush(store, post)).toEqual({
      sent: FLUSH_BATCH,
      left: 1,
    });
    expect(pending(store)).toEqual([result(FLUSH_BATCH)]);
    expect(errors).toHaveBeenCalledExactlyOnceWith(
      'training: batch refused',
      400,
    );
  });

  it('keeps a result enqueued while the batch was posted', async () => {
    const store = filled(2);
    const post = (batch: TrainingResult[]) => {
      enqueue(store, result(9));
      return Promise.resolve(answering(batch));
    };
    expect(await flush(store, post)).toEqual({ sent: 2, left: 1 });
    expect(pending(store)).toEqual([result(9)]);
  });

  it('posts at most a batch at a time, oldest first', async () => {
    const store = filled(FLUSH_BATCH + 2);
    const post = vi.fn((batch: TrainingResult[]) =>
      Promise.resolve(answering(batch)),
    );
    expect(FLUSH_BATCH).toBe(50);
    expect(await flush(store, post)).toEqual({ sent: FLUSH_BATCH, left: 2 });
    expect(ids(post.mock.calls[0]?.[0] ?? [])).toEqual(
      ids(Array.from({ length: FLUSH_BATCH }, (_, n) => result(n))),
    );
    expect(pending(store)).toEqual([
      result(FLUSH_BATCH),
      result(FLUSH_BATCH + 1),
    ]);
  });
});

/** A browser storage holding `entries`, fresh for each test. */
function storageWith(entries: Record<string, string>): Storage {
  window.localStorage.clear();
  for (const [key, value] of Object.entries(entries))
    window.localStorage.setItem(key, value);
  return window.localStorage;
}

const keysOf = (storage: Storage): string[] =>
  Array.from({ length: storage.length }, (_, i) => storage.key(i) ?? '').sort();

/** A storage the browser refuses: every access throws. */
const refused = (): Storage => {
  throw new DOMException('denied', 'SecurityError');
};

describe('clearQueuedResults', () => {
  it("removes every account's queue and nothing else", () => {
    const storage = storageWith({
      [queueKey('rokas')]: '[]',
      [queueKey('gabija')]: '[]',
      'mychess.other': 'kept',
      theme: 'dark',
    });
    clearQueuedResults(() => storage);
    expect(keysOf(storage)).toEqual(['mychess.other', 'theme']);
  });

  it('does nothing where the browser refuses storage', () => {
    expect(() => {
      clearQueuedResults(refused);
    }).not.toThrow();
  });
});

describe('flushThenClear', () => {
  const queued = (accountId: string, results: TrainingResult[]) => ({
    [queueKey(accountId)]: JSON.stringify(results),
  });

  it("posts the account's queue once, then clears every queue", async () => {
    const storage = storageWith({
      ...queued('rokas', [result(1), result(2)]),
      ...queued('gabija', [result(3)]),
    });
    const post = vi.fn((batch: TrainingResult[]) =>
      Promise.resolve(answering(batch)),
    );
    await flushThenClear(() => storage, 'rokas', post);
    expect(post).toHaveBeenCalledOnce();
    expect(post.mock.calls[0]?.[0].map((r) => r.resultId)).toEqual(
      ids([result(1), result(2)]),
    );
    expect(keysOf(storage)).toEqual([]);
  });

  it('clears the queues even when the post fails', async () => {
    const storage = storageWith(queued('rokas', [result(1)]));
    await flushThenClear(
      () => storage,
      'rokas',
      () => Promise.reject(new TypeError('offline')),
    );
    expect(keysOf(storage)).toEqual([]);
  });

  it('waits for the post at most SIGN_OUT_FLUSH_MS, then clears', async () => {
    vi.useFakeTimers();
    try {
      const storage = storageWith(queued('rokas', [result(1)]));
      let settled = false;
      const done = flushThenClear(
        () => storage,
        'rokas',
        () => new Promise<Response>(() => undefined),
      ).then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(SIGN_OUT_FLUSH_MS - 1);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await done;
      expect(keysOf(storage)).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits two seconds at most', () => {
    expect(SIGN_OUT_FLUSH_MS).toBe(2000);
  });

  it('does nothing, and does not throw, where the browser refuses storage', async () => {
    const post = vi.fn(() => Promise.resolve(Response.json({ answers: [] })));
    await expect(
      flushThenClear(refused, 'rokas', post),
    ).resolves.toBeUndefined();
    expect(post).not.toHaveBeenCalled();
  });
});
