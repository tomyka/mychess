import {
  isPlayerMove,
  moveKey,
  type RepertoireGraph,
  type ReviewState,
} from '@mychess/chess';
import type { Db } from '../../src';
import { reviewRow } from '../../src/training/reviews';
import { reviews } from '../../src/training-schema';

/** How a Review entered training: a learn pass, or "I know this". */
export type Entered = { learnedAt: Date } | { skippedAt: Date };

/** Writes `review` for `playerId` directly, stamped when it entered training. */
export async function writeReview(
  db: Db,
  playerId: string,
  review: ReviewState,
  entered: Entered,
): Promise<void> {
  const at = 'learnedAt' in entered ? entered.learnedAt : entered.skippedAt;
  await db.insert(reviews).values({
    playerId,
    ...reviewRow(review),
    ...entered,
    createdAt: at,
    updatedAt: at,
  });
}

/** The review keys of `graph`'s player moves, in graph order. */
export const keysOf = (graph: RepertoireGraph): string[] =>
  graph.moves
    .filter((m) => isPlayerMove(graph, m))
    .map((m) => moveKey(m.from, m.san));
