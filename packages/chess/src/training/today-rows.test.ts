import { describe, expect, it } from 'vitest';
import { importPgn } from '../pgn/import-pgn';
import {
  playerKeys,
  type RepertoireGraph,
  type Side,
} from '../repertoire/graph';
import { DAY_MS, startReview, type ReviewState } from './schedule';
import type { TrainingRepertoire } from './scope';
import { todayRows, trackedReviews } from './today-rows';
import type { TrainingDay } from './training-day';

const NOW = new Date('2026-11-25T08:00:00Z');

function graph(pgn: string, side: Side): RepertoireGraph {
  const r = importPgn(pgn, side);
  if (!r.ok) throw new Error(r.refusal.reason);
  return r.value.graph;
}

// Three White moves and two Black moves.
const white = graph('1. e4 e5 2. Nf3 Nc6 3. Bc4 *', 'white');
const black = graph('1. e4 c6 2. d4 d5 *', 'black');
const empty: RepertoireGraph = { side: 'white', chapters: [], moves: [] };
const [E4 = '', NF3 = '', BC4 = ''] = playerKeys(white);
const [C6 = '', D5 = ''] = playerKeys(black);

const repertoire = (
  g: RepertoireGraph,
  id: string,
  active = true,
): TrainingRepertoire => ({ id, graph: g, active });

/** A Review of `key` started at NOW: learned, due a day later. */
const fresh = (key: string): ReviewState => startReview(key, NOW);

/** A Review of `key` started a day before NOW: due now. */
const dueNow = (key: string): ReviewState =>
  startReview(key, new Date(NOW.getTime() - DAY_MS));

function day(
  repertoires: readonly TrainingRepertoire[],
  reviews: readonly ReviewState[] = [],
  overrides: Partial<TrainingDay> = {},
): TrainingDay {
  return {
    repertoires,
    reviews: new Map(reviews.map((r) => [r.key, r])),
    tracked: new Set(reviews.map((r) => r.key)),
    knownWithoutLearning: new Set(),
    learnedToday: 0,
    limits: { reviews: 20, newPerDay: 10 },
    ...overrides,
  };
}

const W = repertoire(white, 'w');
const B = repertoire(black, 'b');

describe('todayRows', () => {
  it('lists the repertoires with due moves first, then the learn order', () => {
    const rows = todayRows(day([W, B], [dueNow(C6)]), NOW);
    expect(rows.map((r) => [r.repertoireId, r.due])).toEqual([
      ['b', 1],
      ['w', 0],
    ]);
  });

  it('orders due repertoires by their earliest due Review', () => {
    const later = startReview(
      E4,
      new Date(NOW.getTime() - DAY_MS / 2 - DAY_MS),
    );
    const rows = todayRows(day([W, B], [dueNow(C6), dueNow(D5), later]), NOW);
    expect(rows.map((r) => [r.repertoireId, r.due])).toEqual([
      ['w', 1],
      ['b', 2],
    ]);
  });

  it('keeps the learn order with nothing due', () => {
    const third = repertoire(white, 'x');
    const rows = todayRows(day([B, third, W]), NOW);
    expect(rows.map((r) => [r.repertoireId, r.due])).toEqual([
      ['b', 0],
      ['x', 0],
      ['w', 0],
    ]);
  });

  it('can learn while moves are left and the allowance allows', () => {
    const rows = todayRows(day([W, B], [fresh(C6), fresh(D5)]), NOW);
    expect(rows.map((r) => [r.repertoireId, r.canLearn])).toEqual([
      ['w', true],
      ['b', false],
    ]);
  });

  it('cannot learn once today has learned the new moves a day', () => {
    const rows = todayRows(day([W], [], { learnedToday: 10 }), NOW);
    expect(rows.map((r) => r.canLearn)).toEqual([false]);
  });

  it('can learn with one new move of the day left', () => {
    const rows = todayRows(day([W], [], { learnedToday: 9 }), NOW);
    expect(rows.map((r) => r.canLearn)).toEqual([true]);
  });

  it('starts a review before learning when moves are due', () => {
    // 'w' has a due move and new moves to learn; 'b' only new moves.
    const rows = todayRows(day([W, B], [dueNow(E4)]), NOW);
    expect(rows.map((r) => [r.repertoireId, r.canLearn, r.action])).toEqual([
      ['w', true, 'review'],
      ['b', true, 'learn'],
    ]);
  });

  it('starts nothing when every move is tracked and none is due', () => {
    const rows = todayRows(day([B], [fresh(C6), fresh(D5)]), NOW);
    expect(rows.map((r) => [r.due, r.canLearn, r.action])).toEqual([
      [0, false, null],
    ]);
  });

  it('reviews due moves even with the day allowance used', () => {
    const rows = todayRows(
      day([W, B], [dueNow(E4)], { learnedToday: 10 }),
      NOW,
    );
    expect(rows.map((r) => [r.repertoireId, r.canLearn, r.action])).toEqual([
      ['w', false, 'review'],
      ['b', false, null],
    ]);
  });

  it('gives a paused repertoire no due moves and nothing to learn', () => {
    const paused = repertoire(white, 'p', false);
    const rows = todayRows(day([paused], [dueNow(E4)]), NOW);
    expect(rows).toEqual([
      {
        repertoireId: 'p',
        due: 0,
        canLearn: false,
        action: null,
        standing: {
          counts: { notStarted: 2, skipped: 0, due: 1, learned: 0 },
          mastered: false,
        },
      },
    ]);
  });

  it('counts each own move in its one state', () => {
    const rows = todayRows(
      day([W], [dueNow(E4), fresh(NF3), fresh(BC4)], {
        knownWithoutLearning: new Set([BC4]),
      }),
      NOW,
    );
    expect(rows.map((r) => r.standing)).toEqual([
      {
        counts: { notStarted: 0, skipped: 1, due: 1, learned: 1 },
        mastered: false,
      },
    ]);
  });

  it('is mastered when every move is learned and recalled well', () => {
    const rows = todayRows(
      day([W, B], [fresh(E4), fresh(NF3), fresh(BC4), fresh(C6)]),
      NOW,
    );
    expect(rows.map((r) => [r.repertoireId, r.standing])).toEqual([
      [
        'w',
        {
          counts: { notStarted: 0, skipped: 0, due: 0, learned: 3 },
          mastered: true,
        },
      ],
      [
        'b',
        {
          counts: { notStarted: 1, skipped: 0, due: 0, learned: 1 },
          mastered: false,
        },
      ],
    ]);
  });

  it('gives a repertoire without own moves zero counts and nothing to learn', () => {
    const rows = todayRows(day([repertoire(empty, 'e')]), NOW);
    expect(rows).toEqual([
      {
        repertoireId: 'e',
        due: 0,
        canLearn: false,
        action: null,
        standing: {
          counts: { notStarted: 0, skipped: 0, due: 0, learned: 0 },
          mastered: false,
        },
      },
    ]);
  });

  it('lists nothing without repertoires', () => {
    expect(todayRows(day([]), NOW)).toEqual([]);
  });
});

describe('trackedReviews', () => {
  it('pairs each Review with whether it entered by "I know this"', () => {
    const learned = fresh(E4);
    const known = fresh(NF3);
    const d = day([W], [learned, known], {
      knownWithoutLearning: new Set([NF3]),
    });
    const tracked = trackedReviews(d);
    expect([...tracked.keys()]).toEqual([E4, NF3]);
    expect(tracked.get(E4)).toEqual({
      review: learned,
      knownWithoutLearning: false,
    });
    expect(tracked.get(NF3)).toEqual({
      review: known,
      knownWithoutLearning: true,
    });
  });
});
