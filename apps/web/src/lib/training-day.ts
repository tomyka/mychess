// A training snapshot as chess's training day: the rules of what is due,
// what may be learned and where the repertoires stand are chess's
// (training-day); this only reads the snapshot's plain data into it, with
// the focus the page names and the moves the browser still queues, the same
// way on the server (home's counts) and in the browser (the drills).
import { withLearned, type TrainingDay } from '@mychess/chess';
import { dayStart } from '@mychess/domain';
import type { TrainingData } from './training-data';

/** The training day `data` holds, caught up with the moves still queued. */
export function dayOf(
  data: Pick<
    TrainingData,
    | 'entries'
    | 'reviews'
    | 'tracked'
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
    learnedToday: data.learnedToday,
    limits: {
      reviews: data.settings.sessionSize,
      newPerDay: data.settings.newPerDay,
    },
    ...(data.focus === undefined ? {} : { focus: data.focus }),
  };
  return data.queued === undefined
    ? day
    : withLearned(day, data.queued, dayStart(data.now));
}
