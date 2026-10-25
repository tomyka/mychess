// The start state, and the counts it and home's "Today" block read
// (lib/training-counts.ts), over one snapshot fixture.
import { moveKey, playerKeys, START_KEY, startReview } from '@mychess/chess';
import { describe, expect, it } from 'vitest';
import { graphOf, LONDON, TAIMANOV } from '../../../test/fixtures/repertoires';
import type { TrainingData } from '../../lib/training-data';
import { learnLines, newKeys, trainingCounts } from '../../lib/training-counts';
import { startState } from './training-start';

const NOW = new Date('2026-10-25T08:00:00Z');
const LATER = new Date('2026-10-26T08:00:00Z');
const london = graphOf(LONDON);
/** The London's first move, 1. d4: a White repertoire's own move. */
const D4 = moveKey(START_KEY, 'd4');
/** Every own move of the London. */
const LONDON_KEYS = [...new Set(playerKeys(london))];

function data(overrides: Partial<TrainingData> = {}): TrainingData {
  return {
    mode: 'review',
    entries: [
      {
        id: 'r1',
        name: 'London',
        side: 'white',
        kind: 'own',
        active: true,
        graph: london,
      },
    ],
    others: [],
    reviews: [],
    learned: [],
    learnedToday: 0,
    settings: { sessionSize: 20, newPerDay: 10 },
    nextDue: null,
    now: NOW,
    ...overrides,
  };
}

/** A Review of `key` due at `due`. */
function reviewDue(key: string, due: Date) {
  const review = startReview(key, NOW);
  return { ...review, fsrs: { ...review.fsrs, due } };
}

describe('where a training session starts', () => {
  it('is the drill when a review is due', () => {
    expect(
      startState(data({ reviews: [reviewDue(D4, NOW)], learned: [D4] })),
    ).toEqual({ kind: 'drill' });
  });

  it('is nothing due, with the new moves the allowance lets the player learn', () => {
    expect(
      startState(
        data({
          reviews: [reviewDue(D4, LATER)],
          learned: [D4],
          nextDue: LATER,
        }),
      ),
    ).toEqual({ kind: 'nothingDue', toLearn: LONDON_KEYS.length - 1 });
  });

  it('caps the new moves at what is left of today’s allowance', () => {
    expect(
      startState(
        data({ settings: { sessionSize: 20, newPerDay: 3 }, learnedToday: 1 }),
      ),
    ).toEqual({ kind: 'nothingDue', toLearn: 2 });
  });

  it('offers no new moves once today’s allowance is used', () => {
    expect(
      startState(
        data({ settings: { sessionSize: 20, newPerDay: 3 }, learnedToday: 5 }),
      ),
    ).toEqual({ kind: 'nothingDue', toLearn: 0 });
  });

  it('is no moves when no repertoire holds a move of the player’s side', () => {
    const blackWithoutMoves = graphOf('1. e4 *', 'black');
    expect(
      startState(
        data({
          entries: [
            {
              id: 'r1',
              name: 'Empty',
              side: 'black',
              kind: 'own',
              active: true,
              graph: blackWithoutMoves,
            },
          ],
        }),
      ),
    ).toEqual({ kind: 'noMoves' });
    expect(startState(data({ mode: 'learn', entries: [] }))).toEqual({
      kind: 'noMoves',
    });
  });

  it('is the learn drill while new moves and allowance are left', () => {
    expect(startState(data({ mode: 'learn' }))).toEqual({ kind: 'drill' });
  });

  it('is limit reached when the allowance is used but moves are left', () => {
    expect(
      startState(
        data({
          mode: 'learn',
          settings: { sessionSize: 20, newPerDay: 0 },
        }),
      ),
    ).toEqual({ kind: 'limitReached' });
  });

  it('is nothing left when every move is learned', () => {
    expect(startState(data({ mode: 'learn', learned: LONDON_KEYS }))).toEqual({
      kind: 'nothingLeft',
    });
  });

  it('learns nothing from a paused repertoire', () => {
    const paused = data({
      mode: 'learn',
      entries: data().entries.map((e) => ({ ...e, active: false })),
    });
    expect(startState(paused)).toEqual({ kind: 'nothingLeft' });
    expect(startState({ ...paused, mode: 'review' })).toEqual({
      kind: 'nothingDue',
      toLearn: 0,
    });
  });

  it('refuses settings out of range as a programmer error', () => {
    expect(() =>
      startState(data({ settings: { sessionSize: 5, newPerDay: 10 } })),
    ).toThrow();
  });
});

describe('the lines a learn session teaches', () => {
  it('teaches up to today’s allowance, from the first own move', () => {
    const lines = learnLines(data({ learnedToday: 7 }));
    expect(newKeys(lines)).toHaveLength(3);
    expect(newKeys(lines)[0]).toBe(D4);
  });

  it('plans no move learned before again', () => {
    const lines = learnLines(data({ learned: [D4] }));
    expect(newKeys(lines)).not.toContain(D4);
    expect(newKeys(lines)).toHaveLength(LONDON_KEYS.length - 1);
  });

  it('teaches nothing once today’s allowance is used', () => {
    expect(learnLines(data({ learnedToday: 10 }))).toEqual([]);
  });

  it('teaches nothing once every move is learned', () => {
    expect(learnLines(data({ learned: LONDON_KEYS }))).toEqual([]);
  });
});

describe('the counts a page shows before training (U1-M1-3)', () => {
  const taimanov = graphOf(TAIMANOV, 'black');
  const both = [
    ...data().entries,
    {
      id: 'r2',
      name: 'Taimanov',
      side: 'black' as const,
      kind: 'assigned' as const,
      active: true,
      graph: taimanov,
    },
  ];
  const allKeys = [...LONDON_KEYS, ...new Set(playerKeys(taimanov))];
  const [, BF4 = D4] = LONDON_KEYS;

  it('counts every due review, not only a session of them', () => {
    expect(allKeys.length).toBeGreaterThan(10);
    expect(
      trainingCounts(
        data({
          entries: both,
          reviews: allKeys.map((key) => reviewDue(key, NOW)),
          learned: allKeys,
          settings: { sessionSize: 10, newPerDay: 10 },
        }),
      ),
    ).toEqual({ due: allKeys.length, toLearn: 0 });
  });

  it('counts the reviews due by now and the new moves allowed today', () => {
    expect(
      trainingCounts(
        data({
          reviews: [reviewDue(D4, NOW), reviewDue(BF4, LATER)],
          learned: [D4, BF4],
          settings: { sessionSize: 20, newPerDay: 3 },
          learnedToday: 1,
        }),
      ),
    ).toEqual({ due: 1, toLearn: 2 });
  });

  it('counts nothing from a paused repertoire', () => {
    expect(
      trainingCounts(
        data({
          entries: data().entries.map((e) => ({ ...e, active: false })),
          reviews: [reviewDue(D4, NOW)],
          learned: [D4],
        }),
      ),
    ).toEqual({ due: 0, toLearn: 0 });
  });
});
