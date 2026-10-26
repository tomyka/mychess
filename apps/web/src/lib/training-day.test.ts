// The snapshot read as chess's training day: each field reaches the rule
// that reads it. The rules themselves are chess's tests (training-day).
import {
  dueReviews,
  learnLines,
  moveKey,
  newKeys,
  playerKeys,
  START_KEY,
  startReview,
  startState,
  trainingCounts,
} from '@mychess/chess';
import { describe, expect, it } from 'vitest';
import { graphOf, LONDON, TAIMANOV } from '../../test/fixtures/repertoires';
import { dayOf } from './training-day';
import type { TrainingData } from './training-data';

const NOW = new Date('2026-10-25T08:00:00Z');
const LATER = new Date('2026-10-26T08:00:00Z');
const london = graphOf(LONDON);
const taimanov = graphOf(TAIMANOV, 'black');
/** The London's first move, 1. d4: a White repertoire's own move. */
const D4 = moveKey(START_KEY, 'd4');
const LONDON_KEYS = [...new Set(playerKeys(london))];
const ALL_KEYS = [...LONDON_KEYS, ...new Set(playerKeys(taimanov))];

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
      {
        id: 'r2',
        name: 'Taimanov',
        side: 'black',
        kind: 'assigned',
        active: true,
        graph: taimanov,
      },
    ],
    others: [],
    reviews: [],
    learned: [],
    learnedToday: 0,
    settings: { sessionSize: 20, newPerDay: 10 },
    now: NOW,
    ...overrides,
  };
}

/** A Review of `key` due at `due`. */
function reviewDue(key: string, due: Date) {
  const review = startReview(key, NOW);
  return { ...review, fsrs: { ...review.fsrs, due } };
}

describe('a training snapshot as a training day', () => {
  it('keeps the entries in learn order, each with its id, graph and pause', () => {
    const paused = data().entries.map((e) => ({
      ...e,
      active: e.id === 'r2' ? false : e.active,
    }));
    expect(dayOf(data({ entries: paused })).repertoires).toEqual([
      { id: 'r1', graph: london, active: true },
      { id: 'r2', graph: taimanov, active: false },
    ]);
  });

  it('keys the Reviews by move, so the due ones are counted', () => {
    const day = dayOf(
      data({
        reviews: [reviewDue(D4, NOW), reviewDue('elsewhere', LATER)],
        learned: [D4],
      }),
    );
    expect(day.reviews.get(D4)?.key).toBe(D4);
    expect(trainingCounts(day, NOW).due).toBe(1);
  });

  it('cuts a session at the session size, yet counts every due Review', () => {
    const day = dayOf(
      data({
        reviews: ALL_KEYS.map((key) => reviewDue(key, NOW)),
        learned: ALL_KEYS,
        settings: { sessionSize: 10, newPerDay: 10 },
      }),
    );
    expect(dueReviews(day, NOW)).toHaveLength(10);
    expect(trainingCounts(day, NOW).due).toBe(ALL_KEYS.length);
  });

  it('allows the new moves a day less those learned today', () => {
    const day = dayOf(
      data({ settings: { sessionSize: 20, newPerDay: 3 }, learnedToday: 1 }),
    );
    expect(trainingCounts(day, NOW).toLearn).toBe(2);
    expect(startState(dayOf(data({ learnedToday: 10 })), 'learn', NOW)).toEqual(
      { kind: 'limitReached' },
    );
  });

  it('plans no learned or skipped move again', () => {
    const keys = newKeys(learnLines(dayOf(data({ learned: [D4] }))));
    expect(keys).not.toContain(D4);
    expect(keys).toHaveLength(10);
  });
});
