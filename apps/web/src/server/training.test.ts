import { startReview, type ReviewState } from '@mychess/chess';
import type { TrainingScope, TrainingSnapshot } from '@mychess/db';
import type { Account } from '@mychess/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { graphOf, LONDON, TAIMANOV } from '../../test/fixtures/repertoires';
import { loadTraining, parseTrainingSearch } from './training';

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

vi.mock('@mychess/db', () => ({ trainingSnapshot: server.snapshot }));
vi.mock('./db', () => ({ getDb: () => DB }));

/** Rokas, signed in and onboarded: the session account. */
const ROKAS: Account = {
  id: 'rokas',
  email: 'rokas@example.test',
  emailVerified: true,
  displayName: 'Rokas',
  locale: 'lt',
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
    },
    {
      kind: 'own',
      deadline: null,
      position: 0,
      repertoire: { id: ID, graph: LONDON_GRAPH, active: true },
      name: 'Londono sistema',
      side: 'white',
    },
  ],
  others: [{ id: THIRD, name: 'Kito', side: 'white', graph: LONDON_GRAPH }],
  reviews: new Map([
    ['k1|d4', review('k1|d4')],
    ['k2|Bf4', review('k2|Bf4')],
  ]),
  learned: new Set(['k1|d4', 'k2|Bf4']),
  learnedToday: 3,
  settings: { sessionSize: 20, newPerDay: 5 },
  nextDue: new Date('2026-10-21T08:00:00Z'),
};

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  server.snapshot.mockReset().mockResolvedValue(SNAPSHOT);
  return () => {
    vi.useRealTimers();
  };
});

describe('parseTrainingSearch', () => {
  it('reads the mode and the repertoire', () => {
    expect(parseTrainingSearch({ mode: 'learn', r: ID })).toEqual({
      mode: 'learn',
      scope: { kind: 'repertoire', repertoireId: ID },
    });
  });

  it('is a review of every repertoire with nothing given', () => {
    expect(parseTrainingSearch({})).toEqual({
      mode: 'review',
      scope: { kind: 'all' },
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
      });
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
      learned: ['k1|d4', 'k2|Bf4'],
      learnedToday: 3,
      settings: { sessionSize: 20, newPerDay: 5 },
      nextDue: new Date('2026-10-21T08:00:00Z'),
      now: NOW,
    });
  });

  it('is undefined for a scope the player does not train', async () => {
    server.snapshot.mockResolvedValue(undefined);
    expect(
      await loadTraining(ROKAS, 'review', {
        kind: 'repertoire',
        repertoireId: OTHER,
      }),
    ).toBeUndefined();
  });
});
