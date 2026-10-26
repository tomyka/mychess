/**
 * "I know this" (R-58) and "Learn again" (R-147) on a move, a line or a
 * chapter of one repertoire the player trains. The domain decides whether
 * the player may mark the scope known (canMarkKnown) and chess which moves
 * each action changes (knowThis, learnAgainKeys); this module loads the
 * repertoires the player trains, holds their Reviews of the scope's
 * repertoire FOR UPDATE and writes. Every statement filters by the session
 * player.
 */
import {
  knowThis,
  learnAgainKeys,
  ok,
  type Result,
  type ReviewState,
  type Scope,
} from '@mychess/chess';
import {
  canMarkKnown,
  type KnowScope,
  type TrainingRefusal,
} from '@mychess/domain';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { Executor } from '../client';
import { trainingRepertoires } from '../assignments/player';
import { reviews } from '../training-schema';
import {
  lockReviews,
  reviewRow,
  reviewsOf,
  type StoredReview,
} from './reviews';
import { serialiseTraining } from './serialise';

/** The keys "Learn again" removes: skipped and never drilled (R-147). */
function againKeys(
  scope: Scope,
  stored: ReadonlyMap<string, StoredReview>,
): string[] {
  const states = new Map<string, ReviewState>();
  const skipped = new Set<string>();
  for (const [key, { review, skippedAt }] of stored) {
    states.set(key, review);
    if (skippedAt !== null) skipped.add(key);
  }
  return learnAgainKeys(scope, states, skipped);
}

/**
 * knowThis needs a time to start the Reviews it returns; a count only reads
 * how many there are.
 */
const COUNT_ONLY = new Date(0);

/** How many moves each action would change in a scope. */
interface KnowCounts {
  /** Moves "I know this" would add. */
  readonly know: number;
  /** Skipped moves "Learn again" would remove. */
  readonly again: number;
}

/**
 * How many moves each action would change in `scope`, for the menu and the
 * R-147 confirm, both read from one snapshot. Refused when the scope is
 * not one the player trains.
 */
export function knowCounts(
  db: Executor,
  playerId: string,
  scope: KnowScope,
): Promise<Result<KnowCounts, TrainingRefusal>> {
  return db.transaction(
    async (tx) => {
      const resolved = canMarkKnown(
        await trainingRepertoires(tx, playerId),
        scope,
      );
      if (!resolved.ok) return resolved;
      const stored = await reviewsOf(tx, playerId);
      return ok({
        know: knowThis(resolved.value.scope, stored, COUNT_ONLY).length,
        again: againKeys(resolved.value.scope, stored).length,
      });
    },
    { isolationLevel: 'repeatable read' },
  );
}

const keyRowsSchema = z.array(z.object({ moveKey: z.string() }));

/**
 * "I know this" (R-58): the scope's moves not yet in review start their
 * Reviews at `now`, first due the next day, marked skipped. A Review that
 * exists, learned or skipped, is never overwritten. Returns how many were
 * added; refused when the scope is not one the player trains.
 */
export function markKnown(
  db: Executor,
  playerId: string,
  scope: KnowScope,
  now: Date,
): Promise<Result<number, TrainingRefusal>> {
  return db.transaction(async (tx) => {
    await serialiseTraining(tx, playerId);
    const resolved = canMarkKnown(
      await trainingRepertoires(tx, playerId),
      scope,
    );
    if (!resolved.ok) return resolved;
    const locked = await lockReviews(tx, playerId, resolved.value.keys);
    const added = knowThis(resolved.value.scope, locked, now);
    if (added.length === 0) return ok(0);
    const inserted = keyRowsSchema.parse(
      await tx
        .insert(reviews)
        .values(
          added.map((review) => ({
            playerId,
            ...reviewRow(review),
            skippedAt: now,
            createdAt: now,
            updatedAt: now,
          })),
        )
        .onConflictDoNothing()
        .returning({ moveKey: reviews.moveKey }),
    );
    return ok(inserted.length);
  });
}

/**
 * "Learn again" (R-147): deletes the scope's skipped Reviews that were never
 * drilled, so the moves go back to the learn pass. Returns how many;
 * refused when the scope is not one the player trains.
 */
export function learnAgain(
  db: Executor,
  playerId: string,
  scope: KnowScope,
): Promise<Result<number, TrainingRefusal>> {
  return db.transaction(async (tx) => {
    await serialiseTraining(tx, playerId);
    const resolved = canMarkKnown(
      await trainingRepertoires(tx, playerId),
      scope,
    );
    if (!resolved.ok) return resolved;
    await lockReviews(tx, playerId, resolved.value.keys);
    const keys = againKeys(resolved.value.scope, await reviewsOf(tx, playerId));
    if (keys.length === 0) return ok(0);
    const deleted = keyRowsSchema.parse(
      await tx
        .delete(reviews)
        .where(
          and(eq(reviews.playerId, playerId), inArray(reviews.moveKey, keys)),
        )
        .returning({ moveKey: reviews.moveKey }),
    );
    return ok(deleted.length);
  });
}
