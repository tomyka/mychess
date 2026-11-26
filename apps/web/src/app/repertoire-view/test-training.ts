// The repertoire page's training, as the component tests build it: nothing
// due, nothing to learn and no standing, with each test overriding what it
// is about.
import type { PanelTraining } from './panel-training';

const REPERTOIRE = '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10';

/** A `PanelTraining` with `overrides` over a trained, empty-handed default. */
export function panelTraining(
  overrides: Partial<PanelTraining>,
): PanelTraining {
  return {
    repertoireId: REPERTOIRE,
    counts: { due: 0, toLearn: 0 },
    learn: {
      tracked: [],
      learnedToday: 0,
      limits: { reviews: 20, newPerDay: 10 },
    },
    limitReached: false,
    standing: {
      counts: { notStarted: 0, skipped: 0, due: 0, learned: 0 },
      mastered: false,
    },
    chapters: {},
    ...overrides,
  };
}
