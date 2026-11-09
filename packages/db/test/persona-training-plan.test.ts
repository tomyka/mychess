import { describe, expect, it } from 'vitest';
import {
  planTraining,
  trainingInstant,
  weekBatches,
  type PlannedDay,
  type TrainingScript,
} from '../src/testing/personas/training-plan';

const NOW = new Date('2026-11-09T08:00:00Z');
const DAY = 86_400_000;

const script = (over: Partial<TrainingScript>): TrainingScript => ({
  trainedDaysAgo: [],
  learn: [],
  lapses: new Map(),
  reviewsPerDay: 100,
  ...over,
});

/** Each day as its date and its results as `kind key`. */
const summary = (days: readonly PlannedDay[]) =>
  days.map((d) => [
    d.at.toISOString().slice(0, 10),
    d.results.map((r) => `${r.kind} ${r.moveKey}`),
  ]);

describe('trainingInstant', () => {
  it("is 05:00 UTC of the day `daysAgo` before now's UTC date", () => {
    expect(trainingInstant(NOW, 1)).toEqual(new Date('2026-11-08T05:00:00Z'));
    expect(trainingInstant(NOW, 30)).toEqual(new Date('2026-10-10T05:00:00Z'));
  });

  it('is always before now, even late in the day', () => {
    const late = new Date('2026-11-09T23:59:00Z');
    expect(trainingInstant(late, 1).getTime()).toBeLessThan(late.getTime());
  });

  it.each([0, -1, 1.5])('throws for %d days ago', (daysAgo) => {
    expect(() => trainingInstant(NOW, daysAgo)).toThrow(/days ago/);
  });
});

describe('planTraining', () => {
  it('learns each step on its day, naming the repertoire it is learned through', () => {
    const days = planTraining(
      script({
        learn: [{ daysAgo: 3, repertoire: 'italian', keys: ['a', 'b'] }],
      }),
      NOW,
    );
    expect(days).toEqual([
      {
        at: new Date('2026-11-06T05:00:00Z'),
        results: [
          { kind: 'learned', moveKey: 'a', repertoire: 'italian' },
          { kind: 'learned', moveKey: 'b', repertoire: 'italian' },
        ],
      },
    ]);
  });

  it('learns a key once, through the first repertoire that teaches it', () => {
    const days = planTraining(
      script({
        learn: [
          { daysAgo: 5, repertoire: 'catalan', keys: ['d4'] },
          { daysAgo: 4, repertoire: 'catalan-a4', keys: ['d4', 'a4'] },
        ],
      }),
      NOW,
    );
    const learned = days
      .flatMap((d) => d.results)
      .filter((r) => r.kind === 'learned');
    expect(learned).toEqual([
      { kind: 'learned', moveKey: 'd4', repertoire: 'catalan' },
      { kind: 'learned', moveKey: 'a4', repertoire: 'catalan-a4' },
    ]);
  });

  it('reviews a learned move on the first trained day it is due, oldest day first', () => {
    const days = planTraining(
      script({
        trainedDaysAgo: [2, 1, 9],
        learn: [{ daysAgo: 10, repertoire: 'r', keys: ['k'] }],
      }),
      NOW,
    );
    expect(summary(days)).toEqual([
      ['2026-10-30', ['learned k']],
      ['2026-10-31', ['pass k']],
      ['2026-11-07', ['pass k']],
    ]);
  });

  it('leaves a due review for the next trained day when the player skips a day', () => {
    const days = planTraining(
      script({
        trainedDaysAgo: [5],
        learn: [{ daysAgo: 8, repertoire: 'r', keys: ['k'] }],
      }),
      NOW,
    );
    expect(summary(days)).toEqual([
      ['2026-11-01', ['learned k']],
      ['2026-11-04', ['pass k']],
    ]);
  });

  it("gives a key's lapses on its first due reviews, then passes", () => {
    const days = planTraining(
      script({
        trainedDaysAgo: [9, 8, 7, 6, 5, 4, 3, 2, 1],
        learn: [{ daysAgo: 10, repertoire: 'r', keys: ['k', 'm'] }],
        lapses: new Map([['k', 2]]),
      }),
      NOW,
    );
    const ofK = days.flatMap((d) =>
      d.results.filter((r) => r.moveKey === 'k').map((r) => r.kind),
    );
    expect(ofK.slice(0, 4)).toEqual(['learned', 'lapse', 'lapse', 'pass']);
    const ofM = days.flatMap((d) =>
      d.results.filter((r) => r.moveKey === 'm').map((r) => r.kind),
    );
    expect(ofM.slice(1)).not.toContain('lapse');
  });

  it('reviews before it learns on a day, so a move learned today waits for tomorrow', () => {
    const days = planTraining(
      script({
        learn: [
          { daysAgo: 2, repertoire: 'r', keys: ['k'] },
          { daysAgo: 1, repertoire: 'r', keys: ['m'] },
        ],
      }),
      NOW,
    );
    expect(summary(days)).toEqual([
      ['2026-11-07', ['learned k']],
      ['2026-11-08', ['pass k', 'learned m']],
    ]);
  });

  it('reviews at most reviewsPerDay a day, the longest overdue first, leaving the rest due', () => {
    const days = planTraining(
      script({
        trainedDaysAgo: [2, 1],
        reviewsPerDay: 2,
        learn: [{ daysAgo: 3, repertoire: 'r', keys: ['a', 'b', 'c'] }],
      }),
      NOW,
    );
    const [, second, third] = summary(days);
    expect(second).toEqual(['2026-11-07', ['pass a', 'pass b']]);
    expect(third?.[0]).toBe('2026-11-08');
    expect(third?.[1]?.[0]).toBe('pass c');
  });

  it('leaves out days with nothing to do', () => {
    expect(planTraining(script({ trainedDaysAgo: [3, 2, 1] }), NOW)).toEqual(
      [],
    );
  });
});

describe('weekBatches', () => {
  const day = (daysAgo: number): PlannedDay => ({
    at: trainingInstant(NOW, daysAgo),
    results: [],
  });

  it('groups days so a batch never spans seven days or more', () => {
    const days = [20, 19, 14, 13, 12, 6, 1].map(day);
    const batches = weekBatches(days);
    expect(batches.map((b) => b.length)).toEqual([3, 2, 2]);
    for (const batch of batches) {
      const first = batch[0]?.at.getTime() ?? 0;
      const last = batch.at(-1)?.at.getTime() ?? 0;
      expect(last - first).toBeLessThan(7 * DAY);
    }
    expect(batches.flat()).toEqual(days);
  });

  it('makes no batch of no days', () => {
    expect(weekBatches([])).toEqual([]);
  });
});
