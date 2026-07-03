import type { Card } from 'ts-fsrs';
import { isDue } from './fsrs';

export interface QueueItem {
  moveId: string;
  card: Card;
  isNew: boolean;
}

const DAILY_NEW_CAP = 10;

/**
 * Build the review queue for a player's session.
 *
 * Priority:
 * 1. Overdue Review cards (due < now, state=Review/Relearning)
 * 2. Learning cards (state=Learning, due now)
 * 3. New cards (capped at DAILY_NEW_CAP per day minus already done today)
 */
export function buildQueue(
  cards: Array<{ moveId: string; card: Card }>,
  newDoneToday: number = 0,
  now: Date = new Date()
): QueueItem[] {
  const overdue: QueueItem[] = [];
  const learning: QueueItem[] = [];
  const newCards: QueueItem[] = [];

  for (const { moveId, card } of cards) {
    if (card.reps === 0) {
      newCards.push({ moveId, card, isNew: true });
    } else if (isDue(card, now)) {
      if (card.state === 1 || card.state === 3) {
        // Learning or Relearning
        learning.push({ moveId, card, isNew: false });
      } else {
        // Review (state=2)
        overdue.push({ moveId, card, isNew: false });
      }
    }
  }

  // Sort overdue by most overdue first
  overdue.sort((a, b) => a.card.due.getTime() - b.card.due.getTime());

  const newBudget = Math.max(0, DAILY_NEW_CAP - newDoneToday);
  return [...overdue, ...learning, ...newCards.slice(0, newBudget)];
}
