'use client';

import type { TrainingResult } from '@mychess/domain';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { trainingResultsRoute } from '../../lib/routes';
import {
  enqueue,
  flush,
  pending,
  queueKey,
  type QueueStore,
} from './result-queue';

/** How often a non-empty queue is tried again (plan decision 10). */
export const SYNC_INTERVAL_MS = 30_000;

/**
 * The queue's one key in the browser's storage, or in memory where storage
 * is refused (a private window, a full quota): the session still works and
 * only loses its unsent results on reload. Once a read or write fails, the
 * memory copy is the queue.
 */
export function browserStore(key: string, storage: () => Storage): QueueStore {
  let memory: string | null = null;
  let inMemory = false;
  return {
    read() {
      if (inMemory) return memory;
      try {
        return storage().getItem(key);
      } catch {
        inMemory = true;
        return memory;
      }
    },
    write(value) {
      memory = value;
      if (inMemory) return;
      try {
        storage().setItem(key, value);
      } catch {
        inMemory = true;
      }
    },
  };
}

/** Posts one batch to the results endpoint, as the session's own. */
export const postBatch = (batch: TrainingResult[]): Promise<Response> =>
  fetch(trainingResultsRoute, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(batch),
  });

export interface ResultSync {
  /** Queues a result and tries to send it at once. */
  record(result: TrainingResult): void;
  /** Results not yet recorded by the server (the R-60 banner's count). */
  readonly unsynced: number;
  /** Tries to send the queue now (the banner's "try now"). */
  retry(): void;
}

/**
 * The account's result queue, kept in sync with the server: flushed on
 * each new result, on mount, when the browser comes back online or shows
 * the page again, and every 30 s while results are waiting. One flush runs
 * at a time; a request for another while it runs repeats it after.
 */
export function useResultSync(accountId: string): ResultSync {
  const store = useMemo(
    () => browserStore(queueKey(accountId), () => window.localStorage),
    [accountId],
  );
  const [unsynced, setUnsynced] = useState(0);
  const flushing = useRef(false);
  /** Flushes asked for so far; one asked for during a flush runs after it. */
  const requests = useRef(0);

  const sync = useCallback(async () => {
    requests.current += 1;
    if (flushing.current) return;
    flushing.current = true;
    let handled: number;
    let progress: Awaited<ReturnType<typeof flush>>;
    do {
      handled = requests.current;
      progress = await flush(store, postBatch);
      setUnsynced(progress.left);
      // A full batch went through: send the rest straight away.
    } while (
      handled < requests.current ||
      (progress.sent > 0 && progress.left > 0)
    );
    flushing.current = false;
  }, [store]);

  useEffect(() => {
    setUnsynced(pending(store).length);
    const onShow = () => {
      void sync();
    };
    onShow();
    window.addEventListener('online', onShow);
    window.addEventListener('pageshow', onShow);
    return () => {
      window.removeEventListener('online', onShow);
      window.removeEventListener('pageshow', onShow);
    };
  }, [store, sync]);

  const waiting = unsynced > 0;
  useEffect(() => {
    if (!waiting) return undefined;
    const timer = setInterval(() => {
      void sync();
    }, SYNC_INTERVAL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [waiting, sync]);

  const record = useCallback(
    (result: TrainingResult) => {
      enqueue(store, result);
      setUnsynced(pending(store).length);
      void sync();
    },
    [store, sync],
  );
  const retry = useCallback(() => {
    void sync();
  }, [sync]);

  return { record, unsynced, retry };
}
