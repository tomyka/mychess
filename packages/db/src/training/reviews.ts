/**
 * A player's stored Reviews (R-53) and the learned set built from them
 * (R-129). Every statement filters by the given player ids; rows are parsed
 * with zod and turned into chess's ReviewState through reviewStateSchema.
 */
import { reviewStateSchema, type ReviewState } from '@mychess/chess';
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

const keyRowsSchema = z.array(
  z.object({ playerId: z.string(), moveKey: z.string().min(1) }),
);

/**
 * Keys learned or skipped: the R-129 learned set, one per requested player
 * (empty when they have none).
 */
export async function learnedKeys(
  db: Executor,
  playerIds: readonly string[],
): Promise<Map<string, ReadonlySet<string>>> {
  const sets = new Map(playerIds.map((id) => [id, new Set<string>()]));
  if (playerIds.length === 0) return sets;
  const rows = keyRowsSchema.parse(
    await db
      .select({ playerId: reviews.playerId, moveKey: reviews.moveKey })
      .from(reviews)
      .where(inArray(reviews.playerId, [...playerIds])),
  );
  for (const { playerId, moveKey } of rows) sets.get(playerId)?.add(moveKey);
  return sets;
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
