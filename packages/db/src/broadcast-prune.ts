/**
 * Pruning the broadcast index to the search window (#344): the dump months
 * and the tournaments that left it are deleted with their games (the games
 * cascade). The domain decides what left (isMonthBeforeBroadcastWindow,
 * isBeforeBroadcastWindow) and which window is safe to prune to
 * (broadcastPruneWindow); this only deletes what it named.
 *
 * Nothing needs re-attributing: a game listed by several months is kept by
 * the newest of them (the month write's conflict rule), so a month leaving
 * the window takes only the games no newer month listed. A tournament's
 * games are its own rounds' (isGameOfTour), listed by no other tournament.
 */
import {
  broadcastMonthSchema,
  broadcastTourIdSchema,
  isBeforeBroadcastWindow,
  isMonthBeforeBroadcastWindow,
  type BroadcastWindow,
} from '@mychess/domain';
import { inArray } from 'drizzle-orm';
import { z } from 'zod';
import { broadcastMonths, broadcastTours } from './broadcast-schema';
import type { Executor } from './client';

/** How many months and tournaments a prune deleted. */
export interface BroadcastPruneCount {
  readonly months: number;
  readonly tours: number;
}

const monthRowsSchema = z.array(z.object({ month: broadcastMonthSchema }));

const tourRowsSchema = z.array(
  z.object({ tourId: broadcastTourIdSchema, lastRoundAt: z.date() }),
);

/**
 * Deletes, in one transaction, the months before `window` and the
 * tournaments whose last round is before it, with their games. A month or
 * tournament the window covers is never deleted, whatever its state.
 */
export async function pruneBroadcastIndex(
  db: Executor,
  window: BroadcastWindow,
): Promise<BroadcastPruneCount> {
  return db.transaction(async (tx) => {
    const months = monthRowsSchema
      .parse(
        await tx.select({ month: broadcastMonths.month }).from(broadcastMonths),
      )
      .map((row) => row.month)
      .filter((month) => isMonthBeforeBroadcastWindow(month, window));
    const tours = tourRowsSchema
      .parse(
        await tx
          .select({
            tourId: broadcastTours.tourId,
            lastRoundAt: broadcastTours.lastRoundAt,
          })
          .from(broadcastTours),
      )
      .filter((tour) => isBeforeBroadcastWindow(tour.lastRoundAt, window))
      .map((tour) => tour.tourId);
    if (months.length > 0) {
      await tx
        .delete(broadcastMonths)
        .where(inArray(broadcastMonths.month, months));
    }
    if (tours.length > 0) {
      await tx
        .delete(broadcastTours)
        .where(inArray(broadcastTours.tourId, tours));
    }
    return { months: months.length, tours: tours.length };
  });
}
