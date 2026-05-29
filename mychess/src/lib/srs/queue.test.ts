import { describe, it, expect } from 'vitest';
import { buildQueue } from '$lib/srs/queue';
import { newCard } from '$lib/srs/fsrs';
import { Rating } from 'ts-fsrs';
import { scheduleReview } from '$lib/srs/fsrs';

describe('buildQueue', () => {
  it('includes new cards', () => {
    const cards = Array.from({ length: 3 }, (_, i) => ({
      moveId: `move-${i}`,
      card: newCard()
    }));
    const queue = buildQueue(cards, 0);
    expect(queue.length).toBe(3);
    expect(queue.every((q) => q.isNew)).toBe(true);
  });

  it('caps new cards at 10 minus already done', () => {
    const cards = Array.from({ length: 15 }, (_, i) => ({
      moveId: `move-${i}`,
      card: newCard()
    }));
    const queue = buildQueue(cards, 3); // 3 done today, budget = 7
    expect(queue.length).toBe(7);
  });

  it('puts overdue Review cards first', () => {
    const overdueCard = scheduleReview(newCard(), Rating.Good).card;
    // Force it to be overdue by backdating due
    const backdated = { ...overdueCard, due: new Date(Date.now() - 86400000) };

    const newC = newCard();
    const cards = [
      { moveId: 'new', card: newC },
      { moveId: 'overdue', card: backdated }
    ];
    const queue = buildQueue(cards, 0);
    // overdue should come before new
    expect(queue[0].moveId).toBe('overdue');
  });
});
