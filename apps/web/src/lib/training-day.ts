// A training snapshot as chess's training day: the rules of what is due,
// what may be learned and where the repertoires stand are chess's
// (training-day); this only reads a snapshot's parts into it. One builder
// serves both sides: the browser's drills read the page's plain data
// (`dayOf`, with the focus the page names and the moves the browser still
// queues), the server's loaders the snapshot's Maps and Sets
// (server/training.ts).
import {
  withLearned,
  type ReviewState,
  type TrainingDay,
  type TrainingRepertoire,
} from '@mychess/chess';
import { dayStart, type TrainingSettings } from '@mychess/domain';
import type { TrainingData } from './training-data';

/** What a training day is built from, as arrays or as a snapshot's Maps and Sets. */
export interface DayParts {
  /** In the learn order (R-145). */
  readonly repertoires: Iterable<TrainingRepertoire>;
  readonly reviews: Iterable<ReviewState>;
  readonly tracked: Iterable<string>;
  readonly knownWithoutLearning: Iterable<string>;
  readonly learnedToday: number;
  readonly settings: TrainingSettings;
}

/**
 * The training day of `parts`, without a focus: the Reviews by key, and the
 * player's session size and new moves a day as its limits (R-146).
 */
export function trainingDay(parts: DayParts): TrainingDay {
  return {
    repertoires: [...parts.repertoires],
    reviews: new Map(Array.from(parts.reviews, (r) => [r.key, r])),
    tracked: new Set(parts.tracked),
    knownWithoutLearning: new Set(parts.knownWithoutLearning),
    learnedToday: parts.learnedToday,
    limits: {
      reviews: parts.settings.sessionSize,
      newPerDay: parts.settings.newPerDay,
    },
  };
}

/** The training day `data` holds, caught up with the moves still queued. */
export function dayOf(
  data: Pick<
    TrainingData,
    | 'entries'
    | 'reviews'
    | 'tracked'
    | 'knownWithoutLearning'
    | 'learnedToday'
    | 'settings'
    | 'now'
    | 'queued'
    | 'focus'
  >,
): TrainingDay {
  const day: TrainingDay = {
    ...trainingDay({
      ...data,
      repertoires: data.entries.map(({ id, graph, active }) => ({
        id,
        graph,
        active,
      })),
    }),
    ...(data.focus === undefined ? {} : { focus: data.focus }),
  };
  return data.queued === undefined
    ? day
    : withLearned(day, data.queued, dayStart(data.now));
}
