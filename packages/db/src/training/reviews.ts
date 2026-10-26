/**
 * A player's stored Reviews (R-53) and the learned set built from them
 * (R-129). Every statement filters by the given player ids; rows are parsed
 * with zod and turned into chess's ReviewState through reviewStateSchema.
 */
import {
  reviewStateSchema,
  type ReviewState,
  type TrackedReview,
} from '@mychess/chess';
import { and, count, eq, gte, inArray, lt } from 'drizzle-orm';
import { z } from 'zod';
import type { Executor } from '../client';
import { reviews } from '../training-schema';

const reviewRowSchema = z.object({
  moveKey: z.string().min(1),
  due: z.date(),
  stability: z.number(),
  difficulty: z.number(),
  elapsedDays: z.number().int(),
  scheduledDays: z.number().int(),
  learningSteps: z.number().int(),
  reps: z.number().int(),
  lapses: z.number().int(),
  state: z.number().int(),
  lastReview: z.date().nullable(),
  lapseTimes: z.array(z.date()),
  learnedAt: z.date().nullable(),
  skippedAt: z.date().nullable(),
});
type ReviewRow = z.infer<typeof reviewRowSchema>;

const reviewColumns = {
  moveKey: reviews.moveKey,
  due: reviews.due,
  stability: reviews.stability,
  difficulty: reviews.difficulty,
  elapsedDays: reviews.elapsedDays,
  scheduledDays: reviews.scheduledDays,
  learningSteps: reviews.learningSteps,
  reps: reviews.reps,
  lapses: reviews.lapses,
  state: reviews.state,
  lastReview: reviews.lastReview,
  lapseTimes: reviews.lapseTimes,
  learnedAt: reviews.learnedAt,
  skippedAt: reviews.skippedAt,
};

/** A stored row as the ReviewState chess schedules from. */
function toReviewState(row: ReviewRow): ReviewState {
  return reviewStateSchema.parse({
    key: row.moveKey,
    fsrs: {
      due: row.due,
      stability: row.stability,
      difficulty: row.difficulty,
      elapsed_days: row.elapsedDays,
      scheduled_days: row.scheduledDays,
      learning_steps: row.learningSteps,
      reps: row.reps,
      lapses: row.lapses,
      state: row.state,
      ...(row.lastReview === null ? {} : { last_review: row.lastReview }),
    },
    lapses: row.lapseTimes,
  });
}

/**
 * A ReviewState's FSRS state as its FSRS columns in `reviews`.
 * Parsed rather than read field by field: ts-fsrs marks `elapsed_days`
 * deprecated, yet it is still stored.
 */
const fsrsColumnsSchema = z
  .object({
    due: z.date(),
    stability: z.number(),
    difficulty: z.number(),
    elapsed_days: z.number().int(),
    scheduled_days: z.number().int(),
    learning_steps: z.number().int(),
    reps: z.number().int(),
    lapses: z.number().int(),
    state: z.number().int(),
    last_review: z.date().optional(),
  })
  .transform((fsrs) => ({
    due: fsrs.due,
    stability: fsrs.stability,
    difficulty: fsrs.difficulty,
    elapsedDays: fsrs.elapsed_days,
    scheduledDays: fsrs.scheduled_days,
    learningSteps: fsrs.learning_steps,
    reps: fsrs.reps,
    lapses: fsrs.lapses,
    state: fsrs.state,
    lastReview: fsrs.last_review ?? null,
  }));

/** The columns that store a Review: its key, FSRS columns and lapse history. */
export type ReviewColumns = z.output<typeof fsrsColumnsSchema> & {
  readonly moveKey: string;
  readonly lapseTimes: Date[];
};

/** The columns that store `review` (its key, FSRS columns and lapse history). */
export function reviewRow(review: ReviewState): ReviewColumns {
  return {
    moveKey: review.key,
    ...fsrsColumnsSchema.parse(review.fsrs),
    lapseTimes: [...review.lapses],
  };
}

/** A Review and how it entered training: a learn pass or "I know this". */
export interface StoredReview {
  readonly review: ReviewState;
  readonly learnedAt: Date | null;
  readonly skippedAt: Date | null;
}

/** Every Review of `playerId`, by move key. */
export async function reviewsOf(
  db: Executor,
  playerId: string,
): Promise<Map<string, StoredReview>> {
  const rows = z
    .array(reviewRowSchema)
    .parse(
      await db
        .select(reviewColumns)
        .from(reviews)
        .where(eq(reviews.playerId, playerId)),
    );
  return new Map(
    rows.map((row) => [
      row.moveKey,
      {
        review: toReviewState(row),
        learnedAt: row.learnedAt,
        skippedAt: row.skippedAt,
      },
    ]),
  );
}

/**
 * The player's Reviews of `keys`, by key, each row held FOR UPDATE for the
 * rest of `tx`. Locked in key order, so two batches never deadlock.
 */
export async function lockReviews(
  tx: Executor,
  playerId: string,
  keys: readonly string[],
): Promise<Map<string, ReviewState>> {
  const rows = z.array(reviewRowSchema).parse(
    await tx
      .select(reviewColumns)
      .from(reviews)
      .where(
        and(
          eq(reviews.playerId, playerId),
          inArray(reviews.moveKey, [...keys]),
        ),
      )
      .orderBy(reviews.moveKey)
      .for('update'),
  );
  return new Map(rows.map((row) => [row.moveKey, toReviewState(row)]));
}

const keyRowsSchema = z.array(
  z.object({ playerId: z.string(), moveKey: z.string().min(1) }),
);

/**
 * Keys learned or skipped: the R-129 learned set, one per requested player
 * (empty when they have none). Given `keys`, only those are read: a
 * repertoire's player moves are all a done check needs.
 */
export async function learnedKeys(
  db: Executor,
  playerIds: readonly string[],
  keys?: readonly string[],
): Promise<Map<string, ReadonlySet<string>>> {
  const sets = new Map(playerIds.map((id) => [id, new Set<string>()]));
  if (playerIds.length === 0) return sets;
  const rows = keyRowsSchema.parse(
    await db
      .select({ playerId: reviews.playerId, moveKey: reviews.moveKey })
      .from(reviews)
      .where(
        and(
          inArray(reviews.playerId, [...playerIds]),
          keys && inArray(reviews.moveKey, [...keys]),
        ),
      ),
  );
  for (const { playerId, moveKey } of rows) sets.get(playerId)?.add(moveKey);
  return sets;
}

const trackedRowsSchema = z.array(
  reviewRowSchema.extend({ playerId: z.string().min(1) }),
);

/**
 * The Reviews of `keys` for each of `playerIds`, by player then key, each
 * with whether it entered by "I know this" (R-151). One statement whatever
 * the number of players; none for no players or no keys. A player with no
 * such Review has an empty map. Ungated: the caller decides who may read
 * whose Reviews and passes only those player ids.
 */
export async function trackedReviews(
  db: Executor,
  playerIds: readonly string[],
  keys: readonly string[],
): Promise<Map<string, Map<string, TrackedReview>>> {
  const out = new Map(
    playerIds.map((id) => [id, new Map<string, TrackedReview>()]),
  );
  if (playerIds.length === 0 || keys.length === 0) return out;
  const rows = trackedRowsSchema.parse(
    await db
      .select({ playerId: reviews.playerId, ...reviewColumns })
      .from(reviews)
      .where(
        and(
          inArray(reviews.playerId, [...playerIds]),
          inArray(reviews.moveKey, [...keys]),
        ),
      ),
  );
  for (const row of rows)
    out.get(row.playerId)?.set(row.moveKey, {
      review: toReviewState(row),
      skipped: row.skippedAt !== null,
    });
  return out;
}

const countRowsSchema = z.array(z.object({ n: z.number().int() })).length(1);

/** How many moves the player learned (not skipped) in [from, to) (R-147). */
export async function learnedBetween(
  db: Executor,
  playerId: string,
  from: Date,
  to: Date,
): Promise<number> {
  const [row] = countRowsSchema.parse(
    await db
      .select({ n: count() })
      .from(reviews)
      .where(
        and(
          eq(reviews.playerId, playerId),
          gte(reviews.learnedAt, from),
          lt(reviews.learnedAt, to),
        ),
      ),
  );
  return row?.n ?? 0;
}
