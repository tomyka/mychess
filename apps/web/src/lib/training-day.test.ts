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
  todayRows,
  trainingCounts,
} from '@mychess/chess';
import { describe, expect, it } from 'vitest';
import { graphOf, LONDON, TAIMANOV } from '../../test/fixtures/repertoires';
import { dayOf, trainingDay } from './training-day';
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
        coachName: 'Ona',
        active: true,
        graph: taimanov,
      },
    ],
    others: [],
    reviews: [],
    tracked: [],
    knownWithoutLearning: [],
    learnedToday: 0,
    coachNotes: [],
    settings: { sessionSize: 20, newPerDay: 10, learnArrows: true },
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
        tracked: [D4],
      }),
    );
    expect(day.reviews.get(D4)?.key).toBe(D4);
    expect(trainingCounts(day, NOW).due).toBe(1);
  });

  it('cuts a session at the session size, yet counts every due Review', () => {
    const day = dayOf(
      data({
        reviews: ALL_KEYS.map((key) => reviewDue(key, NOW)),
        tracked: ALL_KEYS,
        settings: { sessionSize: 10, newPerDay: 10, learnArrows: true },
      }),
    );
    expect(dueReviews(day, NOW)).toHaveLength(10);
    expect(trainingCounts(day, NOW).due).toBe(ALL_KEYS.length);
  });

  it('allows the new moves a day less those learned today', () => {
    const day = dayOf(
      data({
        settings: { sessionSize: 20, newPerDay: 3, learnArrows: true },
        learnedToday: 1,
      }),
    );
    expect(trainingCounts(day, NOW).toLearn).toBe(2);
    expect(startState(dayOf(data({ learnedToday: 10 })), 'learn', NOW)).toEqual(
      { kind: 'limitReached' },
    );
  });

  it('plans no learned or skipped move again', () => {
    const keys = newKeys(learnLines(dayOf(data({ tracked: [D4] }))));
    expect(keys).not.toContain(D4);
    expect(keys).toHaveLength(10);
  });
});

describe('a snapshot with a focus (R-206)', () => {
  it('learns only the chapter the page names', () => {
    const chapterId = london.chapters[0]?.id ?? '';
    const day = dayOf(
      data({ mode: 'learn', focus: { repertoireId: 'r1', chapterId } }),
    );
    expect(day.focus).toEqual({ repertoireId: 'r1', chapterId });
    const lines = learnLines(day);
    expect(lines.length).toBeGreaterThan(0);
    expect(new Set(lines.map((l) => l.repertoireId))).toEqual(new Set(['r1']));
  });

  it('learns nothing in a chapter the repertoire does not have', () => {
    const day = dayOf(
      data({
        mode: 'learn',
        focus: { repertoireId: 'r1', chapterId: 'missing' },
      }),
    );
    expect(learnLines(day)).toEqual([]);
    expect(startState(day, 'learn', NOW)).toEqual({ kind: 'nothingLeft' });
  });

  it('learns every repertoire without one', () => {
    expect(dayOf(data({ mode: 'learn' })).focus).toBeUndefined();
  });
});

describe('one builder for arrays and for a snapshot’s Maps and Sets', () => {
  it('builds the same day from either, with the settings as its limits (R-146)', () => {
    const reviews = [reviewDue(D4, LATER)];
    const parts = {
      repertoires: [{ id: 'r1', graph: london, active: true }],
      learnedToday: 2,
      settings: { sessionSize: 15, newPerDay: 4, learnArrows: false },
    };
    const fromArrays = trainingDay({
      ...parts,
      reviews,
      tracked: [D4],
      knownWithoutLearning: [D4],
    });
    const fromSets = trainingDay({
      ...parts,
      reviews: new Map(reviews.map((r) => [r.key, r])).values(),
      tracked: new Set([D4]),
      knownWithoutLearning: new Set([D4]),
    });
    expect(fromSets).toEqual(fromArrays);
    expect(fromArrays).toEqual({
      repertoires: parts.repertoires,
      reviews: new Map([[D4, reviews[0]]]),
      tracked: new Set([D4]),
      knownWithoutLearning: new Set([D4]),
      learnedToday: 2,
      limits: { reviews: 15, newPerDay: 4 },
    });
  });
});

describe('the moves entered by "I know this" (R-58, #383)', () => {
  it('reach the day, so a known move counts as skipped, a learned one as learned', () => {
    const later = (key: string) => reviewDue(key, LATER);
    const day = dayOf(
      data({
        entries: data().entries.slice(0, 1),
        reviews: LONDON_KEYS.map(later),
        tracked: LONDON_KEYS,
        knownWithoutLearning: [D4],
      }),
    );
    expect(day.knownWithoutLearning).toEqual(new Set([D4]));
    const [row] = todayRows(day, NOW);
    expect(row?.standing.counts).toMatchObject({
      skipped: 1,
      learned: LONDON_KEYS.length - 1,
    });
  });
});

describe('a snapshot caught up with the browser’s queue (#330 decision 2)', () => {
  it('does not teach again a move learned on an earlier page whose result is still queued', () => {
    const fresh = data({ mode: 'learn' });
    expect(newKeys(learnLines(dayOf(fresh)))).toContain(D4);
    const caught = dayOf({ ...fresh, queued: [{ key: D4, at: NOW }] });
    expect(caught.tracked.has(D4)).toBe(true);
    expect(newKeys(learnLines(caught))).not.toContain(D4);
    expect(caught.learnedToday).toBe(1);
  });

  it('counts toward today only a queued move learned since the day began', () => {
    const yesterday = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);
    const caught = dayOf(data({ queued: [{ key: D4, at: yesterday }] }));
    expect(caught.tracked.has(D4)).toBe(true);
    expect(caught.learnedToday).toBe(0);
  });
});
