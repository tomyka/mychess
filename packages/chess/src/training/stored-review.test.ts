import { describe, expect, it } from 'vitest';
import { grade, startReview } from './schedule';
import { reviewStateSchema, unreviewed } from './stored-review';

const now = new Date('2026-10-23T08:00:00Z');
const later = new Date('2026-10-24T09:00:00Z');

/** The review as JSON sent to the browser: every Date becomes ISO text. */
const overJson = (value: unknown): unknown => {
  const parsed: unknown = JSON.parse(JSON.stringify(value));
  return parsed;
};

const started = startReview('k|e4', now);
const withCard = (fields: Record<string, unknown>): unknown => ({
  ...started,
  fsrs: { ...started.fsrs, ...fields },
});

describe('reviewStateSchema', () => {
  it('round-trips a review through its stored shape', () => {
    const review = grade(startReview('k|e4', now), 'lapse', now);
    expect(reviewStateSchema.parse(overJson(review))).toEqual(review);
  });

  it('parses Lapse dates and card dates back into Dates', () => {
    const review = grade(grade(started, 'lapse', now), 'lapse', later);
    const parsed = reviewStateSchema.parse(overJson(review));
    expect(parsed.lapses).toEqual([now, later]);
    expect(parsed.lapses[1]).toBeInstanceOf(Date);
    expect(parsed.fsrs.due).toBeInstanceOf(Date);
    expect(parsed.fsrs.last_review).toEqual(later);
  });

  it('accepts a review whose Dates are still Dates (a database row)', () => {
    const review = grade(started, 'pass', later);
    expect(reviewStateSchema.parse(review)).toEqual(review);
  });

  it('accepts a card without last_review and leaves it absent', () => {
    const card = Object.fromEntries(
      Object.entries(started.fsrs).filter(([field]) => field !== 'last_review'),
    );
    const parsed = reviewStateSchema.parse({ ...started, fsrs: card });
    expect('last_review' in parsed.fsrs).toBe(false);
  });

  it('accepts every FSRS state', () => {
    for (const state of [0, 1, 2, 3]) {
      expect(reviewStateSchema.safeParse(withCard({ state })).success).toBe(
        true,
      );
    }
  });

  it('refuses an unknown FSRS state', () => {
    expect(reviewStateSchema.safeParse(withCard({ state: 7 })).success).toBe(
      false,
    );
  });

  it.each([
    ['a negative stability', { stability: -0.1 }],
    ['a negative difficulty', { difficulty: -1 }],
    ['negative elapsed days', { elapsed_days: -1 }],
    ['fractional scheduled days', { scheduled_days: 1.5 }],
    ['negative learning steps', { learning_steps: -1 }],
    ['negative reps', { reps: -1 }],
    ['fractional lapses', { lapses: 0.5 }],
    ['an unparseable due date', { due: 'not a date' }],
    ['an unparseable last review', { last_review: 'not a date' }],
  ])('refuses %s', (_label, fields) => {
    expect(reviewStateSchema.safeParse(withCard(fields)).success).toBe(false);
  });

  it('refuses an empty key', () => {
    expect(reviewStateSchema.safeParse({ ...started, key: '' }).success).toBe(
      false,
    );
  });

  it('refuses an unparseable Lapse date', () => {
    const review = { ...started, lapses: ['nope'] };
    expect(reviewStateSchema.safeParse(review).success).toBe(false);
  });
});

describe('unreviewed', () => {
  it('is true for a review that has only been started', () => {
    expect(started.fsrs.reps).toBe(1);
    expect(unreviewed(started)).toBe(true);
  });

  it('is false once the review has been graded', () => {
    expect(unreviewed(grade(started, 'pass', now))).toBe(false);
  });

  it('is false once the review has lapsed', () => {
    expect(unreviewed(grade(started, 'lapse', now))).toBe(false);
  });
});
