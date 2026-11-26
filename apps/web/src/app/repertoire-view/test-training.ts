// The repertoire page's training, as the component tests build it: nothing
// due, nothing to learn and no standing, with each test overriding what it
// is about.
import type { Standing } from '@mychess/chess';
import type { RepertoireTraining, TrainNow } from '../../server/training';

const REPERTOIRE = '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10';

/** A standing with no own moves: nothing learned to show. */
const NO_STANDING: Standing = {
  counts: { notStarted: 0, skipped: 0, due: 0, learned: 0 },
  mastered: false,
};

type ChapterStandings = RepertoireTraining['chapters'];

/** A `TrainNow` with `overrides` over a trained, empty-handed default. */
export function trainNow(overrides: Partial<TrainNow>): TrainNow {
  return {
    repertoireId: REPERTOIRE,
    counts: { due: 0, toLearn: 0 },
    learn: {
      tracked: [],
      learnedToday: 0,
      limits: { reviews: 20, newPerDay: 10 },
    },
    limitReached: false,
    ...overrides,
  };
}

/**
 * What the page's loader gives a viewer who trains it now: `standing`, each
 * chapter's, and a `trainNow` with `overrides`.
 */
export function pageTraining(
  overrides: Partial<TrainNow>,
  standing: Standing = NO_STANDING,
  chapters: ChapterStandings = {},
): RepertoireTraining {
  return { standing, chapters, trainable: trainNow(overrides) };
}

/**
 * What the loader gives with nothing to train now, as while paused (R-46,
 * R-228): the standings only.
 */
export const standingsOnly = (
  standing: Standing,
  chapters: ChapterStandings = {},
): RepertoireTraining => ({ standing, chapters, trainable: null });
