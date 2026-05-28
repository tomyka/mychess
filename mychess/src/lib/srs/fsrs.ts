import { createEmptyCard, fsrs, Rating, type Card, type RecordLogItem } from 'ts-fsrs';

const scheduler = fsrs({ request_retention: 0.9, maximum_interval: 365 });

export type { Card };
export { Rating };

export interface ReviewOutcome {
  rating: Rating;
  card: Card;
}

/**
 * Convert response speed to FSRS rating.
 * wrong/hint => Again, >5s => Hard, 2-5s => Good, <2s => Easy
 */
export function speedToRating(responseMs: number, wasWrong: boolean, usedHint: boolean): Rating {
  if (wasWrong || usedHint) return Rating.Again;
  if (responseMs > 5000) return Rating.Hard;
  if (responseMs >= 2000) return Rating.Good;
  return Rating.Easy;
}

/** Create a brand-new FSRS card (for new moves) */
export function newCard(): Card {
  return createEmptyCard();
}

/** Schedule next review. Returns the updated card state. */
export function scheduleReview(card: Card, rating: Rating, now: Date = new Date()): ReviewOutcome {
  // ts-fsrs repeat() returns an IPreview which is indexed by Rating enum numbers
  const records = scheduler.repeat(card, now) as unknown as Record<number, RecordLogItem>;
  const record = records[rating];
  return { rating, card: record.card };
}

/** Get all 4 scheduled options (for UI display) */
export function previewSchedule(card: Card, now: Date = new Date()) {
  return scheduler.repeat(card, now);
}

/** Is this card due for review at the given time? */
export function isDue(card: Card, now: Date = new Date()): boolean {
  return card.due <= now;
}
