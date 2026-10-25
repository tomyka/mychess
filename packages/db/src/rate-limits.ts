/**
 * Our request counters (security A6), for limits Better Auth does not
 * cover, such as the PGN import's (R-119), the magic link's per email
 * (#264) and the training results' (S6). The domain's countRequest decides; this counts atomically per
 * key, in the request_counters table: Better Auth's rate_limits table is
 * pruned by Better Auth itself at its own one-minute horizon.
 */
import {
  IMPORT_RATE_LIMIT,
  MAGIC_LINK_EMAIL_RATE_LIMIT,
  MAGIC_LINK_RATE_LIMIT,
  TRAINING_RATE_LIMIT,
  countRequest,
  ok,
  type RateRefusal,
  type RateRule,
  type Result,
} from '@mychess/domain';
import { eq, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Executor } from './client';
import { rateLimits, requestCounters } from './schema';

/**
 * The longest window of Better Auth 1.7's built-in rules: 10 s by default
 * and for sign-in, 60 s for password reset, verification email and the
 * magic-link plugin. Recheck when upgrading Better Auth.
 */
const BETTER_AUTH_LONGEST_WINDOW_MS = 60_000;

/**
 * How long a rate_limits row can still decide a request: the longest
 * window of Better Auth's rules, ours on its paths included. A row whose
 * last request is older only opens a new window, as no row would, so
 * deleting it changes no decision.
 */
export const BETTER_AUTH_RETENTION_MS = Math.max(
  BETTER_AUTH_LONGEST_WINDOW_MS,
  MAGIC_LINK_RATE_LIMIT.windowMs,
);

/**
 * How long a request_counters row can still decide a request: the longest
 * window of our own limits. A new limit counted here joins this list.
 */
export const REQUEST_COUNTER_RETENTION_MS = Math.max(
  MAGIC_LINK_EMAIL_RATE_LIMIT.windowMs,
  IMPORT_RATE_LIMIT.windowMs,
  TRAINING_RATE_LIMIT.windowMs,
);

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
        .insert(requestCounters)
        .values({ key, count: 0, windowStart: 0 })
        .onConflictDoUpdate({
          target: requestCounters.key,
          set: { key: sql`excluded.key` },
        })
        .returning({
          count: requestCounters.count,
          windowStart: requestCounters.windowStart,
        }),
    );
    const counted = countRequest(row, rule, now.getTime());
    if (!counted.ok) return counted;
    await tx
      .update(requestCounters)
      .set(counted.value)
      .where(eq(requestCounters.key, key));
    return ok();
  });
}

/**
 * Deletes the rows that can no longer decide a request at `now`: Better
 * Auth's rate_limits rows older than BETTER_AUTH_RETENTION_MS and our
 * request_counters rows older than REQUEST_COUNTER_RETENTION_MS (#262).
 * Better Auth keeps one row per client address and path, and deletes stale
 * ones only as a side effect of some key opening a new window; our
 * counters it never touches. A scheduled prune bounds both tables.
 * Returns how many rows it deleted from the two together.
 */
export async function pruneRateLimits(
  db: Executor,
  now: Date,
): Promise<number> {
  const at = now.getTime();
  const auth = deletedSchema.parse(
    await db
      .delete(rateLimits)
      .where(lt(rateLimits.lastRequest, at - BETTER_AUTH_RETENTION_MS)),
  );
  const ours = deletedSchema.parse(
    await db
      .delete(requestCounters)
      .where(
        lt(requestCounters.windowStart, at - REQUEST_COUNTER_RETENTION_MS),
      ),
  );
  return auth.rowCount + ours.rowCount;
}
