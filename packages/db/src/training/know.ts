/**
 * "I know this" (R-58) and "Learn again" (R-147) on a move, a line or a
 * chapter of one repertoire the player trains. Chess decides which moves
 * each changes (knowThis, learnAgainKeys); this module resolves the scope
 * against the repertoire as the player has it (their own, or live by
 * assignment and not paused), holds the player's Reviews of it FOR UPDATE
 * and writes. Every statement filters by the session player.
 */
import {
  chapterOf,
  knowThis,
  learnAgainKeys,
  lines,
  ok,
  playerKeys,
  refuse,
  type RepertoireGraph,
  type Result,
  type ReviewState,
  type Scope,
} from '@mychess/chess';
import { TRAINING_REFUSALS, type TrainingRefusal } from '@mychess/domain';
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

/** What the player marks: one move, one line of a chapter, or a chapter. */
export type KnowScope =
  | {
      readonly kind: 'move';
      readonly repertoireId: string;
      readonly moveKey: string;
    }
  | {
      readonly kind: 'line';
      readonly repertoireId: string;
      readonly chapterId: string;
      readonly lineIndex: number;
    }
  | {
      readonly kind: 'chapter';
      readonly repertoireId: string;
      readonly chapterId: string;
    };

/** A scope resolved: chess's Scope and every player move of its repertoire. */
interface Resolved {
  readonly scope: Scope;
  readonly keys: readonly string[];
}

/** The chess Scope of `scope` in `graph`, or undefined when the graph lacks it. */
function chessScope(
  graph: RepertoireGraph,
  scope: KnowScope,
): Scope | undefined {
  switch (scope.kind) {
    case 'move':
      return playerKeys(graph).includes(scope.moveKey)
        ? { kind: 'moves', keys: [scope.moveKey] }
        : undefined;
    case 'line': {
      const line = lines(graph, scope.chapterId)[scope.lineIndex];
      return line === undefined ? undefined : { kind: 'line', graph, line };
    }
    case 'chapter':
      return chapterOf(graph, scope.chapterId) === undefined
        ? undefined
        : { kind: 'chapter', graph, chapterId: scope.chapterId };
  }
}

/** A scope the player does not train now. */
const NOT_TRAINED = refuse(TRAINING_REFUSALS.notTrained);

/**
 * `scope` in the repertoire the player trains; refused when they do not
 * train it, it is paused (R-46), or it has no such move, line or chapter.
 */
async function resolve(
  tx: Executor,
  playerId: string,
  scope: KnowScope,
): Promise<Result<Resolved, TrainingRefusal>> {
  const trained = (await trainingRepertoires(tx, playerId)).find(
    (repertoire) => repertoire.id === scope.repertoireId,
  );
  if (!trained?.active) return NOT_TRAINED;
  const resolved = chessScope(trained.graph, scope);
  return resolved === undefined
    ? NOT_TRAINED
    : ok({ scope: resolved, keys: playerKeys(trained.graph) });
}

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
      const resolved = await resolve(tx, playerId, scope);
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
    const resolved = await resolve(tx, playerId, scope);
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
    const resolved = await resolve(tx, playerId, scope);
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
