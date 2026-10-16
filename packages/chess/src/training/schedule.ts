import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  type Card,
} from 'ts-fsrs';

/** R-76: the target retention is fixed, not a user setting. */
const TARGET_RETENTION = 0.9;
// Fuzz is off so that tests and reviews are deterministic.
const scheduler = fsrs(
  generatorParameters({
    request_retention: TARGET_RETENTION,
    enable_fuzz: false,
  }),
);
/** One day in milliseconds. */
export const DAY_MS = 86_400_000;

/** A drill's result: a pass or a Lapse. R-61: a hint counts as a Lapse. */
export type Outcome = 'pass' | 'lapse' | 'hint';

/** The Review of one player move: its FSRS schedule and its Lapses. */
export interface ReviewState {
  readonly key: string;
  readonly fsrs: Card;
  readonly lapses: readonly Date[];
}

/** Starts review after the learn pass; R-58: the first review is due the next day. */
export function startReview(key: string, now: Date): ReviewState {
  const first = scheduler.next(createEmptyCard(now), now, Rating.Good).card;
  return {
    key,
    fsrs: { ...first, due: new Date(now.getTime() + DAY_MS) },
    lapses: [],
  };
}

export function grade(
  review: ReviewState,
  outcome: Outcome,
  now: Date,
): ReviewState {
  const passed = outcome === 'pass';
  const next = scheduler.next(
    review.fsrs,
    now,
    passed ? Rating.Good : Rating.Again,
  ).card;
  return {
    key: review.key,
    fsrs: next,
    lapses: passed ? review.lapses : [...review.lapses, now],
  };
}

/** The predicted probability, 0 to 1, that the player recalls the move at `now`. */
export function retrievability(review: ReviewState, now: Date): number {
  return scheduler.get_retrievability(review.fsrs, now, false);
}
