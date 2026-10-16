import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { importPgn } from '../pgn/import-pgn';
import { playerKeys, type RepertoireGraph } from '../repertoire/graph';
import {
  MASTERY_RETENTION,
  WEAK_LAPSES,
  WEAK_RETENTION,
  WEAK_WINDOW_DAYS,
} from './progress';
import {
  DAY_MS,
  grade,
  retrievability,
  startReview,
  type ReviewState,
} from './schedule';
import {
  mastered,
  reconcile,
  weakSpots,
  type Scope,
  type TrainingRepertoire,
} from './training';

const now = new Date('2026-10-16T08:00:00Z');
const daysAgo = (days: number) => new Date(now.getTime() - days * DAY_MS);
const fresh = (key: string): ReviewState => startReview(key, daysAgo(0.5));
/** A review with lapses recorded at these times; its schedule stays fresh. */
const withLapses = (key: string, at: readonly Date[]): ReviewState => ({
  ...fresh(key),
  lapses: at,
});
function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a value');
  return value;
}
const moves = (...keys: string[]): Scope => ({ kind: 'moves', keys });

function graphOf(pgn: string): RepertoireGraph {
  const r = importPgn(pgn, 'white');
  if (!r.ok) throw new Error(r.refusal.reason);
  return r.value.graph;
}
const italian = graphOf('1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 Nf6 5. d4 *');
const held = (graph: RepertoireGraph, active = true): TrainingRepertoire => ({
  id: 'r',
  graph,
  active,
});
/** The Italian with only its first  moves. */
const firstMoves = (n: number): RepertoireGraph => ({
  ...italian,
  moves: italian.moves.slice(0, n),
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
  it('needs a review for every key with recall of at least 0.9', () => {
    const reviews = new Map([
      ['a', fresh('a')],
      ['b', fresh('b')],
    ]);
    expect(mastered(moves('a', 'b'), reviews, now)).toBe(true);
    expect(mastered(moves('a', 'b', 'c'), reviews, now)).toBe(false);
    expect(
      mastered(moves('a'), reviews, new Date(now.getTime() + 400 * DAY_MS)),
    ).toBe(false);
  });

  it('is false for no keys: nothing to master is not mastered', () => {
    expect(mastered(moves(), new Map([['a', fresh('a')]]), now)).toBe(false);
  });

  it('stays mastered until recall drops below the threshold', () => {
    const review = fresh('a');
    // Find the first whole hour at which recall drops below the threshold.
    let at = now;
    while (retrievability(review, at) >= MASTERY_RETENTION) {
      at = new Date(at.getTime() + 3_600_000);
    }
    const last = new Date(at.getTime() - 3_600_000);
    const reviews = new Map([['a', review]]);
    expect(mastered(moves('a'), reviews, last)).toBe(true);
    expect(mastered(moves('a'), reviews, at)).toBe(false);
  });
});

describe('weakSpots', () => {
  it('ranks keys with two or more lapses in 30 days', () => {
    // Reviews start before their lapses: ts-fsrs refuses to grade in the past.
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

  it('leaves out a review with one recent lapse and good recall', () => {
    const one = withLapses('one', [daysAgo(1)]);
    expect(weakSpots(new Map([['one', one]]), now)).toEqual([]);
  });

  it('flags a review whose recall fell below 0.7 without lapses', () => {
    const review = fresh('a');
    const later = new Date(now.getTime() + 400 * DAY_MS);
    expect(retrievability(review, later)).toBeLessThan(WEAK_RETENTION);
    expect(weakSpots(new Map([['a', review]]), later)).toEqual([
      { key: 'a', recentLapses: 0, recall: retrievability(review, later) },
    ]);
  });

  it('leaves out Reviews the repertoires no longer hold, so dormant ones do not count', () => {
    const kept = must(playerKeys(italian)[0]);
    const reviews = new Map([
      [kept, withLapses(kept, [daysAgo(1), daysAgo(2)])],
      ['dormant', withLapses('dormant', [daysAgo(1), daysAgo(2)])],
    ]);
    expect(weakSpots(reviews, now).map((s) => s.key)).toEqual([
      kept,
      'dormant',
    ]);
    expect(weakSpots(reviews, now, [held(italian)]).map((s) => s.key)).toEqual([
      kept,
    ]);
    expect(
      weakSpots(reviews, now, [held(italian, false)]).map((s) => s.key),
    ).toEqual([kept]);
    expect(weakSpots(reviews, now, [])).toEqual([]);
  });

  it('sorts by recent lapses, most first, then by recall, lowest first', () => {
    const lapses = (n: number) =>
      Array.from({ length: n }, (_, i) => daysAgo(i + 1));
    const older = (key: string, n: number) => ({
      ...startReview(key, daysAgo(300)),
      lapses: lapses(n),
    });
    const reviews = new Map([
      ['two', withLapses('two', lapses(2))],
      ['three', withLapses('three', lapses(3))],
      ['twoOld', older('twoOld', 2)],
      ['zeroOld', older('zeroOld', 0)],
    ]);
    expect(weakSpots(reviews, now).map((s) => s.key)).toEqual([
      'three',
      'twoOld',
      'two',
      'zeroOld',
    ]);
  });
});

describe('reconcile', () => {
  const keys = playerKeys(italian);
  const [e4, nf3] = [must(keys[0]), must(keys[1])];

  it('keeps, queues and parks keys', () => {
    expect(keys.map((k) => k.split('|')[1])).toEqual([
      'e4',
      'Nf3',
      'Bc4',
      'c3',
      'd4',
    ]);
    const reviews = new Map([
      [e4, fresh(e4)],
      ['gone', fresh('gone')],
    ]);
    expect(reconcile([held(firstMoves(3))], reviews)).toEqual({
      kept: [e4],
      toLearn: [nf3],
      dormant: ['gone'],
    });
  });

  it('sorts each list', () => {
    const reviews = new Map(
      [keys[4], keys[1], 'z', 'x'].map(must).map((k) => [k, fresh(k)]),
    );
    expect(reconcile([held(italian)], reviews)).toEqual({
      kept: [keys[1], keys[4]].sort(),
      toLearn: [keys[0], keys[2], keys[3]].sort(),
      dormant: ['x', 'z'],
    });
  });

  it('holds the keys of every repertoire, a paused one too', () => {
    const black = importPgn('1. e4 c6 2. d4 d5 *', 'black');
    if (!black.ok) throw new Error(black.refusal.reason);
    const blackKeys = playerKeys(black.value.graph);
    const reviews = new Map(
      [...keys, ...blackKeys].map((k) => [k, fresh(k)] as const),
    );
    const r = reconcile(
      [held(italian), { id: 'b', graph: black.value.graph, active: false }],
      reviews,
    );
    expect(r.kept).toEqual([...keys, ...blackKeys].sort());
    expect(r.dormant).toEqual([]);
    expect(reconcile([held(italian)], reviews).dormant).toEqual(
      [...blackKeys].sort(),
    );
  });

  const reviewed = fc.uniqueArray(
    fc.oneof(fc.constantFrom(...keys), fc.string()),
  );

  it('never drops a review whose key still exists', () => {
    expect(() => {
      fc.assert(
        fc.property(fc.nat(italian.moves.length), reviewed, (n, done) => {
          const current = playerKeys(firstMoves(n));
          const reviews = new Map(done.map((k) => [k, fresh(k)]));
          const r = reconcile([held(firstMoves(n))], reviews);
          return done
            .filter((k) => current.includes(k))
            .every((k) => r.kept.includes(k));
        }),
      );
    }).not.toThrow();
  });

  it('places every key in exactly one list', () => {
    expect(() => {
      fc.assert(
        fc.property(fc.nat(italian.moves.length), reviewed, (n, done) => {
          const current = playerKeys(firstMoves(n));
          const r = reconcile(
            [held(firstMoves(n))],
            new Map(done.map((k) => [k, fresh(k)])),
          );
          const all = [...r.kept, ...r.toLearn, ...r.dormant];
          return (
            all.length === new Set([...current, ...done]).size &&
            new Set(all).size === all.length
          );
        }),
      );
    }).not.toThrow();
  });
});
