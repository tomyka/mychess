import { createDb } from '../client';
import { databaseEnvSchema } from '../config';
import { pruneRateLimits } from '../rate-limits';

/**
 * The body of the rate-limits:prune script, for a scheduled job (#262):
 * reads DATABASE_URL (throwing before any connection when it is missing or
 * invalid), deletes the rate_limits and request_counters rows that can no
 * longer decide a request at `now` and prints `rate-limits: pruned <n>`.
 */
export async function runRateLimitsPrune(
  now: Date = new Date(),
): Promise<void> {
  const env = databaseEnvSchema.parse(process.env);
  const { db, close } = createDb(env.DATABASE_URL);
  try {
    const pruned = await pruneRateLimits(db, now);
    process.stdout.write(`rate-limits: pruned ${String(pruned)}\n`);
  } finally {
    await close();
  }
}
