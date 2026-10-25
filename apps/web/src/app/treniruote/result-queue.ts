// The browser's queue of training results not yet recorded (S6 lead
// decision 3, plan decision 10): one stored list per account, posted in
// batches. Pure: the storage and the post are injected, so the hook decides
// where the list lives and how it is sent.
import { trainingResultSchema, type TrainingResult } from '@mychess/domain';
import { z } from 'zod';

/** Where the list lives: one string, as localStorage keeps one key. */
export interface QueueStore {
  read(): string | null;
  write(value: string): void;
}

/** The most results one flush posts. */
export const FLUSH_BATCH = 50;

/** The store key of an account's queue. */
export const queueKey = (accountId: string): string =>
  `mychess.results.${accountId}`;

const queueSchema = z.array(trainingResultSchema);

/** The server's 200: which results of the batch it answered. */
const answersSchema = z.object({
  answers: z.array(z.object({ resultId: z.string() })),
});

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

/** The ids a response answered; empty when it is no answer to record by. */
async function answeredIds(
  response: Response,
  batch: readonly TrainingResult[],
): Promise<ReadonlySet<string>> {
  if (response.status === 400) {
    // The batch can never be recorded: drop it. Logged without the moves.
    console.error('training: batch refused', response.status);
    return new Set(batch.map(({ resultId }) => resultId));
  }
  if (!response.ok) return new Set();
  const body = answersSchema.safeParse(
    await response.json().catch(() => undefined),
  );
  return new Set(
    body.success ? body.data.answers.map(({ resultId }) => resultId) : [],
  );
}

/**
 * Posts the oldest results, at most FLUSH_BATCH, and removes those the
 * server answered: applied, stale, duplicate and refused alike. A network
 * error or any other status keeps them all for the next flush; a 400 drops
 * the batch. `sent` counts the results removed, `left` those still queued.
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
      : await answeredIds(response, batch);
  const sent = batch.filter(({ resultId }) => ids.has(resultId)).length;
  return {
    sent,
    left: sent === 0 ? pending(store).length : remove(store, ids),
  };
}
