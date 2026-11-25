// A training snapshot as chess's training day: the rules of what is due,
// what may be learned and where the repertoires stand are chess's
// (training-day); this only reads the snapshot's plain data into it, with
// the focus the page names and the moves the browser still queues, for the
// drills in the browser. The server's loaders build their day straight from
// the snapshot's Maps and Sets (server/training.ts), with the same limits.
import {
  withLearned,
  type QueueLimits,
  type TrainingDay,
} from '@mychess/chess';
import { dayStart, type TrainingSettings } from '@mychess/domain';
import type { TrainingData } from './training-data';

/** The player's session size and new moves a day as a day's limits (R-146). */
export const limitsOf = (settings: TrainingSettings): QueueLimits => ({
  reviews: settings.sessionSize,
  newPerDay: settings.newPerDay,
});

/** The training day `data` holds, caught up with the moves still queued. */
export function dayOf(
  data: Pick<
    TrainingData,
    | 'entries'
    | 'reviews'
    | 'tracked'
    | 'known'
    | 'learnedToday'
    | 'settings'
    | 'now'
    | 'queued'
    | 'focus'
  >,
): TrainingDay {
  const day: TrainingDay = {
    repertoires: data.entries.map(({ id, graph, active }) => ({
      id,
      graph,
      active,
    })),
    reviews: new Map(data.reviews.map((r) => [r.key, r])),
    tracked: new Set(data.tracked),
    known: new Set(data.known),
    learnedToday: data.learnedToday,
    limits: limitsOf(data.settings),
    ...(data.focus === undefined ? {} : { focus: data.focus }),
  };
  return data.queued === undefined
    ? day
    : withLearned(day, data.queued, dayStart(data.now));
}
