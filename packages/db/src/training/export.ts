/** The account's training in its export (R-40, S6). */
import { RESULT_KINDS, type ResultKind } from '@mychess/domain';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Executor } from '../client';
import { iso, notedMove } from '../export-values';
import { reviewResults, reviews } from '../training-schema';

/**
 * The account's training (S6): its Reviews and every result it sent, each
 * move as notes are, never a repertoire id.
 */
export interface TrainingExport {
  /** By move key. */
  readonly reviews: readonly {
    readonly position: string;
    readonly san: string;
    readonly due: string;
    /** When a learn pass started it (R-55), or null. */
    readonly learnedAt: string | null;
    /** When "I know this" started it (R-58), or null. */
    readonly skippedAt: string | null;
    /** The lapse history (R-56), oldest first. */
    readonly lapseTimes: readonly string[];
  }[];
  /** In answer order. */
  readonly results: readonly {
    readonly position: string;
    readonly san: string;
    readonly kind: ResultKind;
    readonly answeredAt: string;
    readonly applied: boolean;
  }[];
}

const reviewRowsSchema = z.array(
  z.object({
    moveKey: z.string(),
    due: z.date(),
    learnedAt: z.date().nullable(),
    skippedAt: z.date().nullable(),
    lapseTimes: z.array(z.date()),
  }),
);

const resultRowsSchema = z.array(
  z.object({
    moveKey: z.string(),
    kind: z.enum(RESULT_KINDS),
    answeredAt: z.date(),
    applied: z.boolean(),
  }),
);

/** The account's own Reviews and training results (S6). */
export async function exportedTraining(
  db: Executor,
  id: string,
): Promise<TrainingExport> {
  const reviewRows = reviewRowsSchema.parse(
    await db
      .select({
        moveKey: reviews.moveKey,
        due: reviews.due,
        learnedAt: reviews.learnedAt,
        skippedAt: reviews.skippedAt,
        lapseTimes: reviews.lapseTimes,
      })
      .from(reviews)
      .where(eq(reviews.playerId, id))
      .orderBy(asc(reviews.moveKey)),
  );
  const resultRows = resultRowsSchema.parse(
    await db
      .select({
        moveKey: reviewResults.moveKey,
        kind: reviewResults.kind,
        answeredAt: reviewResults.answeredAt,
        applied: reviewResults.applied,
      })
      .from(reviewResults)
      .where(eq(reviewResults.playerId, id))
      .orderBy(asc(reviewResults.answeredAt), asc(reviewResults.resultId)),
  );
  return {
    reviews: reviewRows.map((row) => ({
      ...notedMove(row.moveKey),
      due: row.due.toISOString(),
      learnedAt: iso(row.learnedAt),
      skippedAt: iso(row.skippedAt),
      lapseTimes: row.lapseTimes.map((at) => at.toISOString()),
    })),
    results: resultRows.map((row) => ({
      ...notedMove(row.moveKey),
      kind: row.kind,
      answeredAt: row.answeredAt.toISOString(),
      applied: row.applied,
    })),
  };
}
