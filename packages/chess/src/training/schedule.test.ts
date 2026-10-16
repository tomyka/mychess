import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { grade, retrievability, startReview, type Outcome } from './schedule';

const DAY = 86_400_000;
const now = new Date('2026-10-16T08:00:00Z');

describe('schedule', () => {
  it('starts a review due the next day', () => {
    const card = startReview('k', now);
    expect(card.key).toBe('k');
    expect(card.fsrs.due.getTime()).toBe(now.getTime() + DAY);
    expect(card.lapses).toEqual([]);
  });

  it('pushes a correct answer further out', () => {
    const card = startReview('k', now);
    const at = new Date(card.fsrs.due);
    const next = grade(card, 'correct', at);
    expect(next.key).toBe('k');
    expect(next.fsrs.due.getTime()).toBeGreaterThan(at.getTime() + DAY);
    expect(next.lapses).toEqual([]);
  });

  it('counts a lapse and a hint the same way and records the time', () => {
    const card = startReview('k', now);
    const at = new Date(card.fsrs.due);
    const lapse = grade(card, 'lapse', at);
    const hint = grade(card, 'hint', at);
    expect(lapse.fsrs.due).toEqual(hint.fsrs.due);
    expect(lapse.lapses).toEqual([at]);
    expect(hint.lapses).toEqual([at]);
    expect(lapse.fsrs.due.getTime()).toBeLessThan(
      grade(card, 'correct', at).fsrs.due.getTime(),
    );
  });

  it('keeps earlier lapses when a later answer is correct', () => {
    const card = startReview('k', now);
    const first = new Date(card.fsrs.due);
    const lapsed = grade(card, 'lapse', first);
    const second = new Date(lapsed.fsrs.due);
    expect(grade(lapsed, 'correct', second).lapses).toEqual([first]);
    expect(grade(lapsed, 'hint', second).lapses).toEqual([first, second]);
  });

  it('predicts lower recall as time passes', () => {
    const card = startReview('k', now);
    const soon = retrievability(card, new Date(now.getTime() + 2 * DAY));
    const late = retrievability(card, new Date(now.getTime() + 60 * DAY));
    expect(soon).toBeGreaterThan(late);
    expect(soon).toBeLessThanOrEqual(1);
    expect(late).toBeGreaterThan(0);
  });

  it('always schedules after the grading time', () => {
    expect(() => {
      fc.assert(
        fc.property(
          fc.array(fc.constantFrom<Outcome>('correct', 'lapse', 'hint'), {
            maxLength: 15,
          }),
          (outcomes) => {
            let card = startReview('k', now);
            for (const o of outcomes) {
              const at = new Date(card.fsrs.due);
              card = grade(card, o, at);
              if (card.fsrs.due.getTime() <= at.getTime()) return false;
            }
            return true;
          },
        ),
      );
    }).not.toThrow();
  });
});
