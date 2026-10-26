// The browser's queue of training results not yet recorded (S6 lead
// decision 3, plan decision 10): one stored list per account, posted in
// batches. Pure: the storage and the post are injected, so the hook decides
// where the list lives and how it is sent.
import {
  settleFlush,
  trainingResultSchema,
  type TrainingResult,
} from '@mychess/domain';
import { z } from 'zod';

/** Where the list lives: one string, as localStorage keeps one key. */
export interface QueueStore {
  read(): string | null;
  write(value: string): void;
}

/** The most results one flush posts. */
export const FLUSH_BATCH = 50;

/** What every account's queue key starts with. */
const QUEUE_PREFIX = 'mychess.results.';

/** The store key of an account's queue. */
export const queueKey = (accountId: string): string =>
  `${QUEUE_PREFIX}${accountId}`;

const queueSchema = z.array(trainingResultSchema);

/** The stored value as JSON, or undefined when it is not JSON at all. */
function parsedJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** The queued results, oldest first; a stored value that is not a queue is discarded. */
export function pending(store: QueueStore): TrainingResult[] {
  const raw = store.read();
  if (raw === null) return [];
  const parsed = queueSchema.safeParse(parsedJson(raw));
  return parsed.success ? parsed.data : [];
}

/** Adds a result to the end of the queue. */
export function enqueue(store: QueueStore, result: TrainingResult): void {
  store.write(JSON.stringify([...pending(store), result]));
}

/**
 * Removes the results `ids` names. The queue is read again first, so a
 * result enqueued while a batch was in flight is kept. Returns what is left.
 */
function remove(store: QueueStore, ids: ReadonlySet<string>): number {
  const left = pending(store).filter(({ resultId }) => !ids.has(resultId));
  store.write(JSON.stringify(left));
  return left.length;
}

/**
 * The ids of `batch` to drop on `response` (the domain's settleFlush):
 * none, all of them, or those answered. The body is read only on a 2xx;
 * refusals are logged by status or reason only, never a move or an id.
 */
async function droppedIds(
  response: Response,
  batch: readonly TrainingResult[],
): Promise<ReadonlySet<string>> {
  const verdict = settleFlush(batch, {
    status: response.status,
    body: response.ok
      ? await response.json().catch(() => undefined)
      : undefined,
  });
  if (verdict.kind === 'batchRefused')
    console.error('training: batch refused', verdict.status);
  if (verdict.kind === 'answered')
    for (const reason of verdict.refused)
      console.warn('training: result refused', reason);
  return verdict.drop;
}

/**
 * Posts the oldest results, at most FLUSH_BATCH, and removes those the
 * server answered: applied, stale, duplicate and refused alike. A network
 * error or any other status keeps them all for the next flush; a 400, 403,
 * 413 or 415 drops the batch. `sent` counts the results removed, `left` those still queued.
 */
export async function flush(
  store: QueueStore,
  post: (batch: TrainingResult[]) => Promise<Response>,
): Promise<{ readonly sent: number; readonly left: number }> {
  const batch = pending(store).slice(0, FLUSH_BATCH);
  if (batch.length === 0) return { sent: 0, left: 0 };
  const response = await post(batch).catch(() => undefined);
  const ids =
    response === undefined
      ? new Set<string>()
      : await droppedIds(response, batch);
  const sent = batch.filter(({ resultId }) => ids.has(resultId)).length;
  return {
    sent,
    left: sent === 0 ? pending(store).length : remove(store, ids),
  };
}

/** How long signing out waits for the last flush (security review, S6). */
export const SIGN_OUT_FLUSH_MS = 2000;

/** The queue keys in `storage`, read before any is removed. */
const queueKeys = (storage: Storage): string[] =>
  Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter(
    (key): key is string => key?.startsWith(QUEUE_PREFIX) ?? false,
  );

/**
 * Removes every account's queue from the browser's storage, so no unsent
 * result outlives a sign-out or a deleted account on a shared browser.
 * Where the browser refuses storage there is nothing to remove.
 */
export function clearQueuedResults(storage: () => Storage): void {
  try {
    const store = storage();
    for (const key of queueKeys(store)) store.removeItem(key);
  } catch {
    // Storage refused: no queue was kept in it.
  }
}

/** Resolves after `ms`, and the timer it set, to clear once not needed. */
function timeout(ms: number): { done: Promise<void>; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const done = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  return {
    done,
    cancel: () => {
      clearTimeout(timer);
    },
  };
}

/**
 * Signing out: one last flush of the account's own queue, waited for at
 * most SIGN_OUT_FLUSH_MS, then every queue removed. Only the session's own
 * queue is posted, as the server records any batch for the session account.
 */
export async function flushThenClear(
  storage: () => Storage,
  accountId: string,
  post: (batch: TrainingResult[]) => Promise<Response>,
): Promise<void> {
  const key = queueKey(accountId);
  const store: QueueStore = {
    read: () => storage().getItem(key),
    write: (value) => {
      storage().setItem(key, value);
    },
  };
  const limit = timeout(SIGN_OUT_FLUSH_MS);
  await Promise.race([flush(store, post).catch(() => undefined), limit.done]);
  limit.cancel();
  clearQueuedResults(storage);
}
