import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DAY_MS,
  grade,
  isDue,
  retrievability,
  startReview,
  type Outcome,
} from './schedule';

const now = new Date('2026-10-16T08:00:00Z');

describe('schedule', () => {
  it('is due from its due instant on, not a millisecond before', () => {
    const review = startReview('k', now);
    const due = review.fsrs.due.getTime();
    expect(isDue(review, new Date(due))).toBe(true);
    expect(isDue(review, new Date(due + DAY_MS))).toBe(true);
    expect(isDue(review, new Date(due - 1))).toBe(false);
  });

  it('starts a review due the next day', () => {
    const review = startReview('k', now);
    expect(review.key).toBe('k');
    expect(review.fsrs.due.getTime()).toBe(now.getTime() + DAY_MS);
    expect(review.lapses).toEqual([]);
  });

  it('pushes a pass further out', () => {
    const review = startReview('k', now);
    const at = new Date(review.fsrs.due);
    const next = grade(review, 'pass', at);
    expect(next.key).toBe('k');
    expect(next.fsrs.due.getTime()).toBeGreaterThan(at.getTime() + DAY_MS);
    expect(next.lapses).toEqual([]);
  });

  it('counts a lapse and a hint the same way and records the time', () => {
    const review = startReview('k', now);
    const at = new Date(review.fsrs.due);
    const lapse = grade(review, 'lapse', at);
    const hint = grade(review, 'hint', at);
    expect(lapse.fsrs.due).toEqual(hint.fsrs.due);
    expect(lapse.lapses).toEqual([at]);
    expect(hint.lapses).toEqual([at]);
    expect(lapse.fsrs.due.getTime()).toBeLessThan(
      grade(review, 'pass', at).fsrs.due.getTime(),
    );
  });

  it('keeps earlier lapses when a later review passes', () => {
    const review = startReview('k', now);
    const first = new Date(review.fsrs.due);
    const lapsed = grade(review, 'lapse', first);
    const second = new Date(lapsed.fsrs.due);
    expect(grade(lapsed, 'pass', second).lapses).toEqual([first]);
    expect(grade(lapsed, 'hint', second).lapses).toEqual([first, second]);
  });

  it('predicts lower recall as time passes', () => {
    const review = startReview('k', now);
    const soon = retrievability(review, new Date(now.getTime() + 2 * DAY_MS));
    const late = retrievability(review, new Date(now.getTime() + 60 * DAY_MS));
    expect(soon).toBeGreaterThan(late);
    expect(soon).toBeLessThanOrEqual(1);
    expect(late).toBeGreaterThan(0);
  });

  it('always schedules after the grading time', () => {
    expect(() => {
      fc.assert(
        fc.property(
          fc.array(fc.constantFrom<Outcome>('pass', 'lapse', 'hint'), {
            maxLength: 15,
          }),
          (outcomes) => {
            let review = startReview('k', now);
            for (const o of outcomes) {
              const at = new Date(review.fsrs.due);
              review = grade(review, o, at);
              if (review.fsrs.due.getTime() <= at.getTime()) return false;
            }
            return true;
          },
        ),
      );
    }).not.toThrow();
  });
});
