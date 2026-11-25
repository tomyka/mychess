import type {
  AssignedRepertoire,
  ChangesSince,
  OpenForkOffer,
  PlayerAssignment,
} from '@mychess/db';
import type { Account } from '@mychess/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { graphOf, LONDON } from '../../test/fixtures/repertoires';
import {
  assignedRepertoireData,
  myAssignedRepertoires,
  todayAssignments,
} from './assignment-pages';
import { chapterNamesOf } from './chapter-names';

const ID = '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10';
const DB = { name: 'the db' };
const NOW = new Date('2026-10-20T08:00:00Z');

/** The error the mocked `notFound` throws. */
class NotFound extends Error {}

const server = vi.hoisted(() => ({
  assigned:
    vi.fn<
      (db: unknown, playerId: string, id: string, now: Date) => Promise<unknown>
    >(),
  changes: vi.fn<(db: unknown, request: unknown) => Promise<unknown>>(),
  mine: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  offers: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));

vi.mock('@mychess/db', () => ({
  assignedRepertoireForPlayer: server.assigned,
  changesSince: server.changes,
  playerAssignments: server.mine,
  openForkOffers: server.offers,
}));

vi.mock('./db', () => ({ getDb: () => DB }));

// The session player; requireOnboarded's redirects are session.ts's own.
vi.mock('./session', () => ({
  requireOnboarded: () =>
    Promise.resolve({ id: 'rokas', displayName: 'Rokas' }),
}));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new NotFound();
  },
}));

const GRAPH = graphOf(LONDON);

/** Rokas's London as his coach Jonas assigned it, with Rokas's note. */
const ASSIGNED: AssignedRepertoire = {
  repertoire: {
    id: ID,
    ownerId: 'jonas',
    side: 'white',
    name: 'Londono sistema',
    version: 4,
    createdAt: NOW,
    updatedAt: NOW,
  },
  graph: GRAPH,
  coachName: 'Jonas',
  personalNotes: { 'k|d4': 'Mano planas' },
  paused: true,
  deadline: '2026-10-19',
  overdue: true,
};

const CHANGES: ChangesSince = {
  changes: {
    added: [{ moveKey: 'k|d4', chapterId: 'c1' }],
    removed: [],
    commentsChanged: 2,
  },
};

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  server.assigned.mockReset().mockResolvedValue(ASSIGNED);
  server.changes.mockReset().mockResolvedValue(CHANGES);
  return () => {
    vi.useRealTimers();
  };
});

describe('assignedRepertoireData', () => {
  it('loads the repertoire for the session player as of now, with what changed since their last visit', async () => {
    const data = await assignedRepertoireData(ID);
    expect(server.assigned).toHaveBeenCalledWith(DB, 'rokas', ID, NOW);
    // Only the changes up to the version shown: they match the graph.
    expect(server.changes).toHaveBeenCalledWith(DB, {
      playerId: 'rokas',
      repertoireId: ID,
      upToVersion: 4,
    });
    expect(data).toEqual({
      repertoire: {
        id: ID,
        name: 'Londono sistema',
        side: 'white',
        version: 4,
      },
      coachName: 'Jonas',
      graph: GRAPH,
      personalNotes: { 'k|d4': 'Mano planas' },
      paused: true,
      deadline: '2026-10-19',
      overdue: true,
      names: chapterNamesOf(GRAPH),
      changes: CHANGES.changes,
    });
  });

  it('is 404 for an id that is not a uuid, before reading anything', async () => {
    for (const raw of ['not-a-uuid', '', undefined, 42])
      await expect(assignedRepertoireData(raw)).rejects.toBeInstanceOf(
        NotFound,
      );
    expect(server.assigned).not.toHaveBeenCalled();
  });

  it('is 404 when the repertoire is not assigned to the session player now', async () => {
    server.assigned.mockResolvedValue(undefined);
    await expect(assignedRepertoireData(ID)).rejects.toBeInstanceOf(NotFound);
  });

  it('is 404 when the assignment ended between the two reads', async () => {
    server.changes.mockResolvedValue(undefined);
    await expect(assignedRepertoireData(ID)).rejects.toBeInstanceOf(NotFound);
  });
});

const MINE: PlayerAssignment = {
  repertoireId: ID,
  name: 'Londono sistema',
  side: 'white',
  coachId: 'jonas',
  coachName: 'Jonas',
  deadline: '2026-11-30',
  paused: false,
  done: false,
  badges: { overdue: false, paused: false, forked: false, updated: true },
};

const OFFER: OpenForkOffer = {
  id: 'o-1',
  repertoireId: null,
  name: 'Karo-Kan gynyba: pagrindai',
  side: 'black',
  coachName: 'Rimantas',
  reason: 'deleted',
  expiresAt: NOW,
  daysLeft: 12,
};

describe('todayAssignments', () => {
  /**
   * Gabija, the account Today's page already read; not the mocked session
   * (Rokas), so the loader is seen reading for the account it is given.
   */
  const GABIJA: Account = {
    id: 'gabija',
    email: 'gabija@example.test',
    emailVerified: true,
    displayName: 'Gabija',
    entitlement: 'free',
    admin: false,
    disabledAt: null,
    onboardedAt: NOW,
    coachSince: null,
    createdAt: NOW,
  };

  it('reads the given player’s assignments and open offers, now', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    try {
      server.mine.mockResolvedValue([MINE]);
      server.offers.mockResolvedValue([OFFER]);
      expect(await todayAssignments(GABIJA)).toEqual({
        assigned: [
          {
            repertoireId: ID,
            name: 'Londono sistema',
            side: 'white',
            coachName: 'Jonas',
            deadline: '2026-11-30',
            badges: {
              overdue: false,
              paused: false,
              forked: false,
              updated: true,
            },
          },
        ],
        offers: [
          {
            id: 'o-1',
            name: 'Karo-Kan gynyba: pagrindai',
            coachName: 'Rimantas',
            daysLeft: 12,
          },
        ],
      });
      expect(server.mine).toHaveBeenCalledExactlyOnceWith(DB, 'gabija', NOW);
      expect(server.offers).toHaveBeenCalledExactlyOnceWith(DB, 'gabija', NOW);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('myAssignedRepertoires', () => {
  it('reads the session player’s live assignments, now, as Today shows them (R-16)', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    try {
      server.mine.mockReset().mockResolvedValue([MINE]);
      server.offers.mockReset();
      expect(await myAssignedRepertoires()).toEqual([
        {
          repertoireId: ID,
          name: 'Londono sistema',
          side: 'white',
          coachName: 'Jonas',
          deadline: '2026-11-30',
          badges: MINE.badges,
        },
      ]);
      expect(server.mine).toHaveBeenCalledWith(DB, 'rokas', NOW);
      expect(server.offers).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
