import { z } from 'zod';

/**
 * The SQLSTATEs after which a transaction may simply run again: Postgres
 * rolled it back whole, so nothing of it was written. 40P01 is a deadlock,
 * 40001 a serialization failure.
 */
const conflictSchema = z.object({ code: z.enum(['40P01', '40001']) });

/** pg raises the error itself; drizzle wraps it as the `cause`. */
const isConflict = (error: unknown): boolean =>
  conflictSchema.safeParse(error).success ||
  z.object({ cause: conflictSchema }).safeParse(error).success;

/**
 * Runs `fn` up to `attempts` times while it fails on a deadlock or a
 * serialization failure. Any other error, or the last conflict, is thrown.
 * `fn` must be a whole transaction: a retry inside one cannot recover it.
 */
export async function retryOnConflict<T>(
  fn: () => Promise<T>,
  attempts: number,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= attempts || !isConflict(error)) throw error;
    }
  }
}
