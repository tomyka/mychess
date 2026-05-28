import { describe, it, expect } from 'vitest';
import { speedToRating, newCard, scheduleReview, isDue } from '$lib/srs/fsrs';
import { Rating } from 'ts-fsrs';

describe('speedToRating', () => {
  it('returns Again if wrong', () => {
    expect(speedToRating(1000, true, false)).toBe(Rating.Again);
  });
  it('returns Again if hint used', () => {
    expect(speedToRating(1000, false, true)).toBe(Rating.Again);
  });
  it('returns Easy if < 2s and correct', () => {
    expect(speedToRating(1500, false, false)).toBe(Rating.Easy);
  });
  it('returns Good if 2-5s', () => {
    expect(speedToRating(3000, false, false)).toBe(Rating.Good);
  });
  it('returns Hard if > 5s', () => {
    expect(speedToRating(6000, false, false)).toBe(Rating.Hard);
  });
});

describe('newCard + scheduleReview', () => {
  it('creates a due card', () => {
    const card = newCard();
    expect(card.reps).toBe(0);
    expect(isDue(card)).toBe(true);
  });

  it('scheduleReview advances due date', () => {
    const card = newCard();
    const { card: next } = scheduleReview(card, Rating.Good);
    expect(next.reps).toBeGreaterThan(0);
    expect(next.due.getTime()).toBeGreaterThan(Date.now());
  });
});
