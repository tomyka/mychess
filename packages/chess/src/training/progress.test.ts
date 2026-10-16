import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  mastered,
  MASTERY_RETENTION,
  reconcile,
  WEAK_LAPSES,
  WEAK_RETENTION,
  WEAK_WINDOW_DAYS,
  weakSpots,
} from './progress';
import {
  grade,
  retrievability,
  startReview,
  type ReviewCard,
} from './schedule';

const DAY = 86_400_000;
const now = new Date('2026-10-16T08:00:00Z');
const daysAgo = (days: number) => new Date(now.getTime() - days * DAY);
const fresh = (key: string): ReviewCard => startReview(key, daysAgo(0.5));
/** A card with lapses recorded at these times; its schedule stays fresh. */
const withLapses = (key: string, at: readonly Date[]): ReviewCard => ({
  ...fresh(key),
  lapses: at,
});

describe('thresholds', () => {
  it('match R-56', () => {
    expect([
      MASTERY_RETENTION,
      WEAK_RETENTION,
      WEAK_LAPSES,
      WEAK_WINDOW_DAYS,
    ]).toEqual([0.9, 0.7, 2, 30]);
  });
});

describe('mastered', () => {
  it('needs a card for every key with recall of at least 0.9', () => {
    const cards = new Map([
      ['a', fresh('a')],
      ['b', fresh('b')],
    ]);
    expect(mastered(['a', 'b'], cards, now)).toBe(true);
    expect(mastered(['a', 'b', 'c'], cards, now)).toBe(false);
    expect(mastered(['a'], cards, new Date(now.getTime() + 400 * DAY))).toBe(
      false,
    );
  });

  it('stays mastered until recall drops below the threshold', () => {
    const card = fresh('a');
    // Find the first whole hour at which recall drops below the threshold.
    let at = now;
    while (retrievability(card, at) >= MASTERY_RETENTION) {
      at = new Date(at.getTime() + 3_600_000);
    }
    const last = new Date(at.getTime() - 3_600_000);
    const cards = new Map([['a', card]]);
    expect(mastered(['a'], cards, last)).toBe(true);
    expect(mastered(['a'], cards, at)).toBe(false);
  });
});

describe('weakSpots', () => {
  it('ranks keys with two or more lapses in 30 days', () => {
    // Cards start before their lapses: ts-fsrs refuses to grade in the past.
    let a = startReview('a', daysAgo(60));
    a = grade(a, 'lapse', daysAgo(5));
    a = grade(a, 'lapse', daysAgo(2));
    let b = startReview('b', daysAgo(60));
    b = grade(b, 'lapse', daysAgo(40));
    b = grade(b, 'lapse', daysAgo(35));
    const spots = weakSpots(
      new Map([
        ['a', a],
        ['b', b],
      ]),
      now,
    );
    expect(spots.map((s) => s.key)).toContain('a');
    expect(spots.find((s) => s.key === 'a')?.recentLapses).toBe(2);
  });

  it('counts a lapse exactly 30 days old, not an older one', () => {
    const edge = withLapses('edge', [daysAgo(WEAK_WINDOW_DAYS), daysAgo(1)]);
    const old = withLapses('old', [
      new Date(daysAgo(WEAK_WINDOW_DAYS).getTime() - 1),
      daysAgo(1),
    ]);
    const spots = weakSpots(
      new Map([
        ['edge', edge],
        ['old', old],
      ]),
      now,
    );
    expect(spots).toEqual([
      { key: 'edge', recentLapses: 2, recall: retrievability(edge, now) },
    ]);
  });

  it('leaves out a card with one recent lapse and good recall', () => {
    const one = withLapses('one', [daysAgo(1)]);
    expect(weakSpots(new Map([['one', one]]), now)).toEqual([]);
  });

  it('flags a card whose recall fell below 0.7 without lapses', () => {
    const card = fresh('a');
    const later = new Date(now.getTime() + 400 * DAY);
    expect(retrievability(card, later)).toBeLessThan(WEAK_RETENTION);
    expect(weakSpots(new Map([['a', card]]), later)).toEqual([
      { key: 'a', recentLapses: 0, recall: retrievability(card, later) },
    ]);
  });

  it('sorts by recent lapses, most first, then by recall, lowest first', () => {
    const lapses = (n: number) =>
      Array.from({ length: n }, (_, i) => daysAgo(i + 1));
    const older = (key: string, n: number) => ({
      ...startReview(key, daysAgo(300)),
      lapses: lapses(n),
    });
    const cards = new Map([
      ['two', withLapses('two', lapses(2))],
      ['three', withLapses('three', lapses(3))],
      ['twoOld', older('twoOld', 2)],
      ['zeroOld', older('zeroOld', 0)],
    ]);
    expect(weakSpots(cards, now).map((s) => s.key)).toEqual([
      'three',
      'twoOld',
      'two',
      'zeroOld',
    ]);
  });
});

describe('reconcile', () => {
  it('keeps, queues and parks keys', () => {
    const cards = new Map([
      ['a', fresh('a')],
      ['gone', fresh('gone')],
    ]);
    expect(reconcile(new Set(['a', 'new']), cards)).toEqual({
      kept: ['a'],
      toLearn: ['new'],
      dormant: ['gone'],
    });
  });

  it('sorts each list', () => {
    const cards = new Map(['d', 'b', 'z', 'x'].map((k) => [k, fresh(k)]));
    expect(reconcile(new Set(['n', 'd', 'm', 'b']), cards)).toEqual({
      kept: ['b', 'd'],
      toLearn: ['m', 'n'],
      dormant: ['x', 'z'],
    });
  });

  it('never drops a card whose key still exists', () => {
    expect(() => {
      fc.assert(
        fc.property(
          fc.uniqueArray(fc.string()),
          fc.uniqueArray(fc.string()),
          (current, carded) => {
            const cards = new Map(carded.map((k) => [k, fresh(k)]));
            const r = reconcile(new Set(current), cards);
            return carded
              .filter((k) => current.includes(k))
              .every((k) => r.kept.includes(k));
          },
        ),
      );
    }).not.toThrow();
  });

  it('places every key in exactly one list', () => {
    expect(() => {
      fc.assert(
        fc.property(
          fc.uniqueArray(fc.string()),
          fc.uniqueArray(fc.string()),
          (current, carded) => {
            const r = reconcile(
              new Set(current),
              new Map(carded.map((k) => [k, fresh(k)])),
            );
            const all = [...r.kept, ...r.toLearn, ...r.dormant];
            return (
              all.length === new Set([...current, ...carded]).size &&
              new Set(all).size === all.length
            );
          },
        ),
      );
    }).not.toThrow();
  });
});
