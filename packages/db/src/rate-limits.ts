/**
 * Request counters in Better Auth's rate_limits table (security A6), for
 * limits Better Auth does not cover, such as the PGN import's (R-119).
 * The domain's countRequest decides; this counts atomically per key.
 */
import {
  countRequest,
  type RateRefusal,
  type RateRule,
  type Result,
} from '@mychess/domain';
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Executor } from './client';
import { DONE } from './results';
import { rateLimits } from './schema';

const counterRowsSchema = z.array(
  z.object({ count: z.number().int(), lastRequest: z.number() }),
);

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
    // A new key starts at a count no window still covers.
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
          lastRequest: rateLimits.lastRequest,
        }),
    );
    const counted = countRequest(row, rule, now.getTime());
    if (!counted.ok) return counted;
    await tx
      .update(rateLimits)
      .set(counted.value)
      .where(eq(rateLimits.key, key));
    return DONE;
  });
}
