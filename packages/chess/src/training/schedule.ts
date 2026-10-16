import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  type Card,
} from 'ts-fsrs';

/** R-76: the target retention is fixed, not a user setting. */
export const TARGET_RETENTION = 0.9;
// Fuzz is off so that tests and reviews are deterministic.
const scheduler = fsrs(
  generatorParameters({
    request_retention: TARGET_RETENTION,
    enable_fuzz: false,
  }),
);
const DAY = 86_400_000;

/** R-61: a hint counts as a lapse. */
export type Outcome = 'correct' | 'lapse' | 'hint';

export interface ReviewCard {
  readonly key: string;
  readonly fsrs: Card;
  readonly lapses: readonly Date[];
}

/** Starts review after the learn pass; R-58: the first review is due the next day. */
export function startReview(key: string, now: Date): ReviewCard {
  const first = scheduler.next(createEmptyCard(now), now, Rating.Good).card;
  return {
    key,
    fsrs: { ...first, due: new Date(now.getTime() + DAY) },
    lapses: [],
  };
}

export function grade(
  card: ReviewCard,
  outcome: Outcome,
  now: Date,
): ReviewCard {
  const correct = outcome === 'correct';
  const next = scheduler.next(
    card.fsrs,
    now,
    correct ? Rating.Good : Rating.Again,
  ).card;
  return {
    key: card.key,
    fsrs: next,
    lapses: correct ? card.lapses : [...card.lapses, now],
  };
}

/** The predicted probability, 0 to 1, that the player recalls the move at `now`. */
export function retrievability(card: ReviewCard, now: Date): number {
  return scheduler.get_retrievability(card.fsrs, now, false);
}
