import type { TrainingResult } from '@mychess/domain';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { enqueue, pending, queueKey } from './result-queue';
import {
  browserStore,
  SYNC_INTERVAL_MS,
  useResultSync,
} from './use-result-sync';

const REPERTOIRE = '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10';
const KEY = queueKey('rokas');

const result = (n: number): TrainingResult => ({
  resultId: `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`,
  kind: 'pass',
  moveKey: `k${n.toString()}|d4`,
  repertoireId: REPERTOIRE,
  answeredAt: new Date(Date.UTC(2026, 9, 20, 8, 0, n)),
});

const sentSchema = z.array(z.object({ resultId: z.string() }));

/** The result ids a post sent. */
const sentIds = (init: RequestInit): string[] =>
  sentSchema
    .parse(JSON.parse(typeof init.body === 'string' ? init.body : '[]'))
    .map(({ resultId }) => resultId);

/** The server answering every result it is sent. */
const answering = (_url: string, init: RequestInit): Promise<Response> =>
  Promise.resolve(
    Response.json({
      answers: sentIds(init).map((resultId) => ({
        resultId,
        status: 'applied',
      })),
    }),
  );

const offline = () => Promise.reject(new TypeError('Failed to fetch'));

const fetchMock =
  vi.fn<(url: string, init: RequestInit) => Promise<Response>>();

/** Lets the posts and their responses finish (real I/O ticks; timers are fake). */
const settle = () =>
  act(async () => {
    for (let tick = 0; tick < 10; tick += 1)
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
  });

/** The batches posted so far, as their result ids. */
const posted = () => fetchMock.mock.calls.map(([, init]) => sentIds(init));

const storage = browserStore(KEY, () => window.localStorage);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  window.localStorage.clear();
  fetchMock.mockReset().mockImplementation(answering);
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('useResultSync', () => {
  it('posts a recorded result and counts it down once answered', async () => {
    const { result: hook } = renderHook(() => useResultSync('rokas'));
    act(() => {
      hook.current.record(result(1));
    });
    expect(hook.current.unsynced).toBe(1);
    await settle();
    expect(hook.current.unsynced).toBe(0);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      '/api/training/results',
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(posted()).toEqual([[result(1).resultId]]);
    expect(pending(storage)).toEqual([]);
  });

  it('keeps a result it could not send and retries every 30 s', async () => {
    fetchMock.mockImplementation(offline);
    const { result: hook } = renderHook(() => useResultSync('rokas'));
    act(() => {
      hook.current.record(result(1));
    });
    await settle();
    expect(hook.current.unsynced).toBe(1);
    expect(pending(storage)).toEqual([result(1)]);

    fetchMock.mockImplementation(answering);
    await act(() => vi.advanceTimersByTimeAsync(SYNC_INTERVAL_MS - 1));
    expect(fetchMock).toHaveBeenCalledOnce();
    await act(() => vi.advanceTimersByTimeAsync(1));
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(hook.current.unsynced).toBe(0);

    // Nothing left: no more posts.
    await act(() => vi.advanceTimersByTimeAsync(SYNC_INTERVAL_MS * 3));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(['online', 'pageshow'])('flushes on %s', async (event) => {
    enqueue(storage, result(1));
    fetchMock.mockImplementation(offline);
    const { result: hook } = renderHook(() => useResultSync('rokas'));
    await settle();
    expect(hook.current.unsynced).toBe(1);

    fetchMock.mockImplementation(answering);
    act(() => {
      window.dispatchEvent(new Event(event));
    });
    await settle();
    expect(hook.current.unsynced).toBe(0);
  });

  it('flushes on retry', async () => {
    fetchMock.mockImplementation(offline);
    const { result: hook } = renderHook(() => useResultSync('rokas'));
    act(() => {
      hook.current.record(result(1));
    });
    await settle();
    fetchMock.mockImplementation(answering);
    act(() => {
      hook.current.retry();
    });
    await settle();
    expect(hook.current.unsynced).toBe(0);
  });

  it('sends what an earlier visit left, at once', async () => {
    enqueue(storage, result(1));
    const { result: hook } = renderHook(() => useResultSync('rokas'));
    await settle();
    expect(posted()).toEqual([[result(1).resultId]]);
    expect(hook.current.unsynced).toBe(0);
  });

  it('sends the whole queue, a batch at a time', async () => {
    for (let n = 0; n < 120; n += 1) enqueue(storage, result(n));
    const { result: hook } = renderHook(() => useResultSync('rokas'));
    await settle();
    expect(posted().map((batch) => batch.length)).toEqual([50, 50, 20]);
    expect(hook.current.unsynced).toBe(0);
  });

  it('posts a result recorded during a post once that post is answered', async () => {
    const { result: hook } = renderHook(() => useResultSync('rokas'));
    await settle();
    act(() => {
      hook.current.record(result(1));
    });
    // The first post is in flight now.
    expect(fetchMock).toHaveBeenCalledOnce();
    act(() => {
      hook.current.record(result(2));
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    await settle();
    expect(posted()).toEqual([[result(1).resultId], [result(2).resultId]]);
    expect(hook.current.unsynced).toBe(0);
  });

  it('keeps the queue in memory when storage is refused', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    fetchMock.mockImplementation(offline);
    const { result: hook } = renderHook(() => useResultSync('rokas'));
    act(() => {
      hook.current.record(result(1));
    });
    await settle();
    expect(hook.current.unsynced).toBe(1);
    fetchMock.mockImplementation(answering);
    act(() => {
      hook.current.retry();
    });
    await settle();
    expect(posted()).toEqual([[result(1).resultId], [result(1).resultId]]);
    expect(hook.current.unsynced).toBe(0);
  });
});

describe('browserStore', () => {
  it('reads and writes the one key', () => {
    storage.write('[]');
    expect(window.localStorage.getItem(KEY)).toBe('[]');
    window.localStorage.setItem(KEY, '[1]');
    expect(storage.read()).toBe('[1]');
  });

  it('keeps the last value in memory once storage refuses a write', () => {
    const store = browserStore(KEY, () => window.localStorage);
    window.localStorage.setItem(KEY, '["old"]');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    store.write('["new"]');
    expect(store.read()).toBe('["new"]');
  });

  it('starts empty when there is no storage at all', () => {
    const store = browserStore(KEY, () => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(store.read()).toBeNull();
    store.write('[]');
    expect(store.read()).toBe('[]');
  });
});
