// A training snapshot as chess's training day: the rules of what is due,
// what may be learned and where the repertoires stand are chess's
// (training-day); this only reads the snapshot's plain data into it, the
// same way on the server (home's counts) and in the browser (the drills).
import type { TrainingDay } from '@mychess/chess';
import type { TrainingData } from './training-data';

/** The training day `data` holds. */
export const dayOf = (data: TrainingData): TrainingDay => ({
  repertoires: data.entries.map(({ id, graph, active }) => ({
    id,
    graph,
    active,
  })),
  reviews: new Map(data.reviews.map((r) => [r.key, r])),
  learned: new Set(data.learned),
  learnedToday: data.learnedToday,
  limits: {
    reviews: data.settings.sessionSize,
    newPerDay: data.settings.newPerDay,
  },
});
