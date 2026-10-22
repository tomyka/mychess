/**
 * Request counters in Better Auth's rate_limits table (security A6), for
 * limits Better Auth does not cover, such as the PGN import's (R-119).
 * The domain's countRequest decides; this counts atomically per key.
 *
 * These counters are fixed windows, so for their keys (never Better Auth's)
 * the last_request column holds the epoch milliseconds the current window
 * opened, not the time of the last request.
 */
import {
  RATE_LIMIT_RETENTION_MS,
  countRequest,
  ok,
  type RateRefusal,
  type RateRule,
  type Result,
} from '@mychess/domain';
import { eq, lt, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Executor } from './client';
import { rateLimits } from './schema';

const counterRowsSchema = z.array(
  z.object({ count: z.number().int(), windowStart: z.number() }),
);

/** A DELETE's outcome as node-postgres reports it. */
const deletedSchema = z.object({ rowCount: z.number().int() });

/**
 * Counts a request for `key` at `now` under `rule`: allowed (and counted)
 * or refused (and not counted). The upsert locks the key's row until the
 * transaction ends, so concurrent requests are counted one at a time.
 */
export async function countRateLimited<R extends string>(
  db: Executor,
  key: string,
  rule: RateRule<R>,
  now: Date,
): Promise<Result<undefined, RateRefusal<R>>> {
  return db.transaction(async (tx) => {
    // A new key starts in a window long closed.
    const [row] = counterRowsSchema.parse(
      await tx
        .insert(rateLimits)
        .values({ id: randomUUID(), key, count: 0, lastRequest: 0 })
        .onConflictDoUpdate({
          target: rateLimits.key,
          set: { key: sql`excluded.key` },
        })
        .returning({
          count: rateLimits.count,
          windowStart: rateLimits.lastRequest,
        }),
    );
    const counted = countRequest(row, rule, now.getTime());
    if (!counted.ok) return counted;
    await tx
      .update(rateLimits)
      .set({
        count: counted.value.count,
        lastRequest: counted.value.windowStart,
      })
      .where(eq(rateLimits.key, key));
    return ok();
  });
}

/**
 * Deletes the rate_limits rows that can no longer decide a request at
 * `now`: those whose last request is older than RATE_LIMIT_RETENTION_MS,
 * the longest window of any limit (#262). Better Auth keeps one row per
 * client address and path, and deletes stale ones only as a side effect of
 * some key opening a new window, so a scheduled prune bounds the table.
 * Returns how many rows it deleted.
 */
export async function pruneRateLimits(
  db: Executor,
  now: Date,
): Promise<number> {
  const cutoff = now.getTime() - RATE_LIMIT_RETENTION_MS;
  const deleted = deletedSchema.parse(
    await db.delete(rateLimits).where(lt(rateLimits.lastRequest, cutoff)),
  );
  return deleted.rowCount;
}
