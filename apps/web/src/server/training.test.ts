import { playerKeys, startReview, type ReviewState } from '@mychess/chess';
import type { TrainingScope, TrainingSnapshot } from '@mychess/db';
import type { Account } from '@mychess/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { graphOf, LONDON, TAIMANOV } from '../../test/fixtures/repertoires';
import {
  loadTraining,
  parseTrainingSearch,
  repertoireTraining,
  todayList,
  todaySummary,
} from './training';

const ID = '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10';
const OTHER = '0b6c2a4e-1f3d-4e5a-8b7c-9d0e1f2a3b4c';
const THIRD = '5e2d9c1b-7a3f-4b6e-8d0c-1f2e3a4b5c6d';
const DB = { name: 'the db' };
const NOW = new Date('2026-10-20T08:00:00Z');

const server = vi.hoisted(() => ({
  snapshot:
    vi.fn<
      (
        db: unknown,
        playerId: string,
        scope: unknown,
        now: Date,
      ) => Promise<unknown>
    >(),
}));

const notes = vi.hoisted(() => ({
  shared: vi.fn<
    (
      db: unknown,
      ownerId: string,
      repertoireId: string,
    ) => Promise<
      {
        coachId: string;
        coachName: string;
        moveKey: string;
        text: string;
        updatedAt: Date;
      }[]
    >
  >(),
  kept: vi.fn<
    (
      db: unknown,
      playerId: string,
      forkId: string,
    ) => Promise<{ moveKey: string; text: string; coachName: string }[]>
  >(),
}));

vi.mock('@mychess/db', () => ({
  trainingSnapshot: server.snapshot,
  coachNotesOn: notes.shared,
  forkCoachNotesOn: notes.kept,
}));
vi.mock('./db', () => ({ getDb: () => DB }));

/** Rokas, signed in and onboarded: the session account. */
const ROKAS: Account = {
  id: 'rokas',
  email: 'rokas@example.test',
  emailVerified: true,
  displayName: 'Rokas',
  entitlement: 'free',
  admin: false,
  disabledAt: null,
  onboardedAt: NOW,
  coachSince: null,
  createdAt: NOW,
};

const LONDON_GRAPH = graphOf(LONDON);
const TAIMANOV_GRAPH = graphOf(TAIMANOV, 'black');

const review = (key: string): ReviewState => startReview(key, NOW);

const SNAPSHOT: TrainingSnapshot = {
  entries: [
    {
      kind: 'assigned',
      deadline: '2026-10-30',
      position: 1,
      repertoire: { id: OTHER, graph: TAIMANOV_GRAPH, active: false },
      name: 'Taimanovas',
      side: 'black',
      coachName: 'Name',
    },
    {
      kind: 'own',
      deadline: null,
      position: 0,
      repertoire: { id: ID, graph: LONDON_GRAPH, active: true },
      name: 'Londono sistema',
      side: 'white',
      coachName: null,
    },
  ],
  others: [{ id: THIRD, name: 'Kito', side: 'white', graph: LONDON_GRAPH }],
  reviews: new Map([
    ['k1|d4', review('k1|d4')],
    ['k2|Bf4', review('k2|Bf4')],
  ]),
  tracked: new Set(['k1|d4', 'k2|Bf4']),
  knownWithoutLearning: new Set(['k2|Bf4']),
  learnedToday: 3,
  settings: { sessionSize: 20, newPerDay: 5, learnArrows: false },
};

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  server.snapshot.mockReset().mockResolvedValue(SNAPSHOT);
  notes.shared.mockReset().mockResolvedValue([]);
  notes.kept.mockReset().mockResolvedValue([]);
  return () => {
    vi.useRealTimers();
  };
});

describe('parseTrainingSearch', () => {
  it('reads the mode and the repertoire', () => {
    expect(parseTrainingSearch({ mode: 'learn', r: ID })).toEqual({
      mode: 'learn',
      scope: { kind: 'repertoire', repertoireId: ID },
      focus: null,
    });
  });

  it('is a review of every repertoire with nothing given', () => {
    expect(parseTrainingSearch({})).toEqual({
      mode: 'review',
      scope: { kind: 'all' },
      focus: null,
    });
  });

  it('falls back to review for an unknown or repeated mode', () => {
    for (const mode of ['drill', '', ['learn', 'learn']])
      expect(parseTrainingSearch({ mode }).mode).toBe('review');
  });

  it('drops a repertoire that is not one uuid', () => {
    for (const r of ['not-a-uuid', '', [ID, OTHER]])
      expect(parseTrainingSearch({ mode: 'learn', r })).toEqual({
        mode: 'learn',
        scope: { kind: 'all' },
        focus: null,
      });
  });
});

describe('parseTrainingSearch with a focus (R-206)', () => {
  it('reads a chapter, and a line of it, to learn with r=', () => {
    expect(
      parseTrainingSearch({ mode: 'learn', r: ID, chapter: 'c1', line: '2' })
        .focus,
    ).toEqual({ repertoireId: ID, chapterId: 'c1', lineIndex: 2 });
    expect(
      parseTrainingSearch({ mode: 'learn', r: ID, chapter: 'c1', line: '0' })
        .focus,
    ).toEqual({ repertoireId: ID, chapterId: 'c1', lineIndex: 0 });
    expect(
      parseTrainingSearch({ mode: 'learn', r: ID, chapter: 'c1' }).focus,
    ).toEqual({ repertoireId: ID, chapterId: 'c1' });
  });

  it('keeps the scope to the repertoire with a focus', () => {
    expect(
      parseTrainingSearch({ mode: 'learn', r: ID, chapter: 'c1' }).scope,
    ).toEqual({ kind: 'repertoire', repertoireId: ID });
  });

  it('drops the focus outside learn, without r=, or with a malformed chapter', () => {
    expect(
      parseTrainingSearch({ mode: 'review', r: ID, chapter: 'c1' }).focus,
    ).toBeNull();
    expect(parseTrainingSearch({ mode: 'learn', chapter: 'c1' }).focus).toBe(
      null,
    );
    for (const chapter of ['', 'x'.repeat(21), ['c1', 'c2']])
      expect(
        parseTrainingSearch({ mode: 'learn', r: ID, chapter }).focus,
      ).toBeNull();
  });

  it('keeps the chapter but drops a malformed line', () => {
    for (const line of ['-1', '1.5', 'two', '', ['1', '2']])
      expect(
        parseTrainingSearch({ mode: 'learn', r: ID, chapter: 'c1', line })
          .focus,
      ).toEqual({ repertoireId: ID, chapterId: 'c1' });
  });
});

describe('loadTraining', () => {
  it("reads the session account's snapshot as of now, for the scope", async () => {
    const scope: TrainingScope = { kind: 'repertoire', repertoireId: ID };
    await loadTraining(ROKAS, 'review', scope);
    expect(server.snapshot).toHaveBeenCalledExactlyOnceWith(
      DB,
      'rokas',
      scope,
      NOW,
    );
  });

  it('hands the page plain data in the learn order', async () => {
    expect(await loadTraining(ROKAS, 'learn', { kind: 'all' })).toEqual({
      mode: 'learn',
      entries: [
        {
          id: OTHER,
          name: 'Taimanovas',
          side: 'black',
          kind: 'assigned',
          // The assigning coach's name, for its notes (R-174).
          coachName: 'Name',
          active: false,
          graph: TAIMANOV_GRAPH,
        },
        {
          id: ID,
          name: 'Londono sistema',
          side: 'white',
          kind: 'own',
          active: true,
          graph: LONDON_GRAPH,
        },
      ],
      others: [{ id: THIRD, name: 'Kito', side: 'white', graph: LONDON_GRAPH }],
      reviews: [review('k1|d4'), review('k2|Bf4')],
      tracked: ['k1|d4', 'k2|Bf4'],
      // The player's own "I know this" keys reach the browser (#383).
      knownWithoutLearning: ['k2|Bf4'],
      learnedToday: 3,
      // The arrows setting reaches the page as stored (R-205).
      settings: { sessionSize: 20, newPerDay: 5, learnArrows: false },
      coachNotes: [],
      now: NOW,
    });
  });

  it('hands the page the focus to learn, when the URL names one (R-206)', async () => {
    const scope: TrainingScope = { kind: 'repertoire', repertoireId: ID };
    const focus = { repertoireId: ID, chapterId: 'c1', lineIndex: 1 };
    const data = await loadTraining(ROKAS, 'learn', scope, focus);
    expect(data?.focus).toEqual(focus);
    const whole = await loadTraining(ROKAS, 'learn', scope);
    expect(whole === undefined ? 'none' : 'focus' in whole).toBe(false);
  });

  it("reads the coach notes on the session account's own repertoires only, the fork's first (R-107, R-43, R-49)", async () => {
    notes.kept.mockResolvedValue([
      { moveKey: 'k1|d4', text: 'Kept.', coachName: 'Former coach' },
    ]);
    notes.shared.mockResolvedValue([
      {
        coachId: 'coach-1',
        coachName: 'Coach One',
        moveKey: 'k2|Bf4',
        text: 'Shared.',
        updatedAt: NOW,
      },
    ]);
    const data = await loadTraining(ROKAS, 'review', { kind: 'all' });
    // The session account's id, never one from the request; the assigned
    // repertoire's notes are its comments (R-102).
    expect(notes.shared).toHaveBeenCalledExactlyOnceWith(DB, 'rokas', ID);
    expect(notes.kept).toHaveBeenCalledExactlyOnceWith(DB, 'rokas', ID);
    // Plain data with no coach account id.
    expect(data?.coachNotes).toEqual([
      {
        repertoireId: ID,
        moveKey: 'k1|d4',
        coachName: 'Former coach',
        text: 'Kept.',
        source: 'fork',
      },
      {
        repertoireId: ID,
        moveKey: 'k2|Bf4',
        coachName: 'Coach One',
        text: 'Shared.',
        source: 'shared',
      },
    ]);
  });

  it('refuses an assigned entry the snapshot gives no coach name: a programmer error', async () => {
    const [assigned, own] = SNAPSHOT.entries;
    if (assigned === undefined || own === undefined) throw new Error('two');
    server.snapshot.mockResolvedValue({
      ...SNAPSHOT,
      entries: [{ ...assigned, coachName: null }, own],
    });
    await expect(
      loadTraining(ROKAS, 'review', { kind: 'all' }),
    ).rejects.toThrow('an assigned training entry names its coach');
  });

  it('is undefined for a scope the player does not train', async () => {
    server.snapshot.mockResolvedValue(undefined);
    expect(
      await loadTraining(ROKAS, 'review', {
        kind: 'repertoire',
        repertoireId: OTHER,
      }),
    ).toBeUndefined();
    expect(notes.shared).not.toHaveBeenCalled();
    expect(notes.kept).not.toHaveBeenCalled();
  });
});

/** Every own move of the London: eight keys. */
const LONDON_KEYS = [...new Set(playerKeys(LONDON_GRAPH))];

/** A snapshot of the London alone, with Reviews of `due` keys due now. */
function londonDue(due: readonly string[]): TrainingSnapshot {
  const later = new Date('2026-10-22T08:00:00Z');
  return {
    ...SNAPSHOT,
    entries: SNAPSHOT.entries.filter((e) => e.repertoire.id === ID),
    others: [],
    reviews: new Map(
      LONDON_KEYS.map((key) => {
        const r = review(key);
        const at = due.includes(key) ? NOW : later;
        return [key, { ...r, fsrs: { ...r.fsrs, due: at } }];
      }),
    ),
    tracked: new Set(LONDON_KEYS),
  };
}

describe('todaySummary (U1-M1-3)', () => {
  it("reads the session account's every repertoire as of now, and no coach notes", async () => {
    await todaySummary(ROKAS);
    expect(server.snapshot).toHaveBeenCalledExactlyOnceWith(
      DB,
      'rokas',
      { kind: 'all' },
      NOW,
    );
    expect(notes.shared).not.toHaveBeenCalled();
    expect(notes.kept).not.toHaveBeenCalled();
  });

  it('counts the due moves and rounds the minutes up', async () => {
    expect(LONDON_KEYS).toHaveLength(8);
    server.snapshot.mockResolvedValue(londonDue(LONDON_KEYS));
    // 8 moves at 8 s: 64 s, about 2 minutes. No rows: the shell's badge
    // reads this on every page.
    expect(await todaySummary(ROKAS)).toEqual({
      due: 8,
      toLearn: 0,
      minutes: 2,
      nextDue: null,
    });
    server.snapshot.mockResolvedValue(londonDue(LONDON_KEYS.slice(0, 1)));
    expect(await todaySummary(ROKAS)).toMatchObject({ due: 1, minutes: 1 });
  });

  it('gives the next review time when nothing is due', async () => {
    server.snapshot.mockResolvedValue(londonDue([]));
    expect(await todaySummary(ROKAS)).toEqual({
      due: 0,
      toLearn: 0,
      minutes: 0,
      nextDue: new Date('2026-10-22T08:00:00Z'),
    });
  });

  it('is all zero when the player trains nothing', async () => {
    server.snapshot.mockResolvedValue(undefined);
    expect(await todaySummary(ROKAS)).toEqual({
      due: 0,
      toLearn: 0,
      minutes: 0,
      nextDue: null,
    });
  });

  it('counts the new moves today’s allowance leaves', async () => {
    // Nothing learned yet: 5 a day, 3 learned today.
    server.snapshot.mockResolvedValue({
      ...londonDue([]),
      reviews: new Map(),
      tracked: new Set(),
    });
    expect(await todaySummary(ROKAS)).toMatchObject({
      due: 0,
      toLearn: 2,
      minutes: 0,
      nextDue: null,
    });
  });
});

describe('todayList (R-221)', () => {
  it("reads the session account's every repertoire as of now", async () => {
    await todayList(ROKAS);
    expect(server.snapshot).toHaveBeenCalledExactlyOnceWith(
      DB,
      'rokas',
      { kind: 'all' },
      NOW,
    );
  });

  it('gives each repertoire its name, side, kind, due count, action and standing', async () => {
    server.snapshot.mockResolvedValue(londonDue(LONDON_KEYS));
    expect(await todayList(ROKAS)).toEqual([
      {
        repertoireId: ID,
        name: 'Londono sistema',
        side: 'white',
        kind: 'own',
        due: 8,
        // Every move is tracked: nothing is left to learn.
        canLearn: false,
        action: 'review',
        standing: {
          counts: { notStarted: 0, skipped: 0, due: 8, learned: 0 },
          mastered: false,
        },
      },
    ]);
  });

  it('still lists a repertoire with nothing due', async () => {
    server.snapshot.mockResolvedValue(londonDue([]));
    expect(await todayList(ROKAS)).toMatchObject([
      {
        repertoireId: ID,
        due: 0,
        action: null,
        standing: { counts: { notStarted: 0, skipped: 0, due: 0, learned: 8 } },
      },
    ]);
  });

  it('counts a move entered by "I know this" as skipped (R-151)', async () => {
    const [known = ''] = LONDON_KEYS;
    server.snapshot.mockResolvedValue({
      ...londonDue([]),
      knownWithoutLearning: new Set([known]),
    });
    const [row] = await todayList(ROKAS);
    expect(row?.standing.counts).toEqual({
      notStarted: 0,
      skipped: 1,
      due: 0,
      learned: 7,
    });
  });

  it('lists nothing when the player trains nothing', async () => {
    server.snapshot.mockResolvedValue(undefined);
    expect(await todayList(ROKAS)).toEqual([]);
  });

  it('lists every repertoire, the ones with due moves first (R-207, R-221)', async () => {
    // The London is first in the learn order but has nothing due.
    const london = londonDue([]);
    const [taimanovKey = ''] = playerKeys(TAIMANOV_GRAPH);
    const early = review(taimanovKey);
    server.snapshot.mockResolvedValue({
      ...london,
      entries: [...SNAPSHOT.entries]
        .reverse()
        .map((e) => ({ ...e, repertoire: { ...e.repertoire, active: true } })),
      reviews: new Map([
        ...london.reviews,
        [taimanovKey, { ...early, fsrs: { ...early.fsrs, due: NOW } }],
      ]),
      tracked: new Set([...london.tracked, taimanovKey]),
    });
    const rows = await todayList(ROKAS);
    // Each row named by its own entry, whatever the order.
    expect(
      rows.map((r) => [r.repertoireId, r.name, r.kind, r.due, r.action]),
    ).toEqual([
      [OTHER, 'Taimanovas', 'assigned', 1, 'review'],
      [ID, 'Londono sistema', 'own', 0, null],
    ]);
  });

  it('orders repertoires with due moves the most urgent first (R-207)', async () => {
    const london = londonDue(LONDON_KEYS.slice(0, 1));
    const [taimanovKey = ''] = playerKeys(TAIMANOV_GRAPH);
    const early = review(taimanovKey);
    const earlier = new Date(NOW.getTime() - 60 * 60 * 1000);
    server.snapshot.mockResolvedValue({
      ...london,
      entries: SNAPSHOT.entries.map((e) => ({
        ...e,
        repertoire: { ...e.repertoire, active: true },
      })),
      reviews: new Map([
        ...london.reviews,
        [taimanovKey, { ...early, fsrs: { ...early.fsrs, due: earlier } }],
      ]),
      tracked: new Set([...london.tracked, taimanovKey]),
    });
    const rows = await todayList(ROKAS);
    expect(rows.map((r) => [r.repertoireId, r.name, r.side, r.due])).toEqual([
      [OTHER, 'Taimanovas', 'black', 1],
      [ID, 'Londono sistema', 'white', 1],
    ]);
  });
});

describe('repertoireTraining', () => {
  it('reads the session account’s counts for that repertoire', async () => {
    server.snapshot.mockResolvedValue(londonDue(LONDON_KEYS.slice(0, 3)));
    expect(await repertoireTraining(ROKAS, ID)).toEqual({
      counts: { due: 3, toLearn: 0 },
      learn: {
        tracked: LONDON_KEYS,
        learnedToday: 3,
        limits: { reviews: 20, newPerDay: 5 },
      },
      // Every move is learned: nothing is left, which is no limit.
      limitReached: false,
    });
    expect(server.snapshot).toHaveBeenCalledExactlyOnceWith(
      DB,
      'rokas',
      { kind: 'repertoire', repertoireId: ID },
      NOW,
    );
  });

  it('is null for a repertoire the player does not train', async () => {
    server.snapshot.mockResolvedValue(undefined);
    expect(await repertoireTraining(ROKAS, OTHER)).toBeNull();
  });

  /** The London with one move tracked, another repertoire's key, and `learnedToday`. */
  const fresh = (learnedToday: number): TrainingSnapshot => ({
    ...londonDue([]),
    reviews: new Map(),
    tracked: new Set([LONDON_KEYS[0] ?? '', 'x|y']),
    learnedToday,
    settings: { sessionSize: 20, newPerDay: 3, learnArrows: true },
  });

  it('sends only this repertoire’s tracked moves in its learn budget (R-206)', async () => {
    server.snapshot.mockResolvedValue(fresh(0));
    const training = await repertoireTraining(ROKAS, ID);
    expect(training?.learn).toEqual({
      tracked: [LONDON_KEYS[0]],
      learnedToday: 0,
      limits: { reviews: 20, newPerDay: 3 },
    });
    expect(training?.counts.toLearn).toBe(3);
    expect(training?.limitReached).toBe(false);
  });

  it('says when today’s new moves are used while moves are left (decision 11)', async () => {
    server.snapshot.mockResolvedValue(fresh(3));
    expect(await repertoireTraining(ROKAS, ID)).toEqual({
      counts: { due: 0, toLearn: 0 },
      learn: {
        tracked: [LONDON_KEYS[0]],
        learnedToday: 3,
        limits: { reviews: 20, newPerDay: 3 },
      },
      limitReached: true,
    });
  });

  it('leaves what today’s allowance has left to learn, with no limit yet (R-146)', async () => {
    server.snapshot.mockResolvedValue(fresh(2));
    const training = await repertoireTraining(ROKAS, ID);
    expect(training?.counts.toLearn).toBe(1);
    expect(training?.limitReached).toBe(false);
  });

  it('says no limit for a paused assignment: it offers nothing to learn (R-46)', async () => {
    const paused = fresh(3);
    server.snapshot.mockResolvedValue({
      ...paused,
      entries: paused.entries.map((e) => ({
        ...e,
        repertoire: { ...e.repertoire, active: false },
      })),
    });
    const training = await repertoireTraining(ROKAS, ID);
    expect(training?.counts.toLearn).toBe(0);
    expect(training?.limitReached).toBe(false);
  });
});
