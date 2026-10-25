/**
 * A Review as it is stored and sent to the browser: its FSRS card with
 * dates as Date or ISO text, parsed back into a ReviewState (parse at the
 * edges). `unreviewed` tells "Learn again" (R-147) which skipped moves were
 * never drilled.
 */
import { State } from 'ts-fsrs';
import { z } from 'zod';
import type { ReviewState } from './schedule';

const date = z.coerce.date();
const count = z.number().int().nonnegative();

const cardSchema = z.object({
  due: date,
  stability: z.number().nonnegative(),
  difficulty: z.number().nonnegative(),
  elapsed_days: count,
  scheduled_days: count,
  learning_steps: count,
  reps: count,
  lapses: count,
  state: z.enum(State),
  last_review: date.exactOptional(),
});

/** Typed as a ReviewState schema, so the compiler checks the parsed shape. */
export const reviewStateSchema: z.ZodType<ReviewState> = z.object({
  key: z.string().min(1),
  fsrs: cardSchema,
  lapses: z.array(date),
});

/** startReview grades once, so a Review never drilled since has one rep. */
export const unreviewed = (review: ReviewState): boolean =>
  review.fsrs.reps <= 1;
