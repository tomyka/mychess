import type { LoadedRepertoire, RepertoireListItem } from '@mychess/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { graphOf, LONDON as LONDON_PGN } from '../../test/fixtures/repertoires';
import {
  importTargets,
  myRepertoires,
  repertoireManageData,
  repertoirePageData,
} from './repertoires';

const LONDON = '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10';
const FORK = '0b6c2a4e-1f3d-4e5a-8b7c-9d0e1f2a3b4c';
const DB = { name: 'the db' };
const NOW = new Date('2026-10-20T08:00:00Z');

/** The error the mocked `notFound` throws. */
class NotFound extends Error {}

const server = vi.hoisted(() => ({
  account: vi.fn<() => Promise<unknown>>(),
  list: vi.fn<(db: unknown, ownerId: string) => Promise<unknown>>(),
  assignments:
    vi.fn<
      (
        db: unknown,
        coachId: string,
        repertoireId: string,
        now: Date,
      ) => Promise<unknown>
    >(),
  load: vi.fn<
    (db: unknown, id: string, viewerId: string) => Promise<unknown>
  >(),
  coaches: vi.fn<(db: unknown, ownerId: string) => Promise<unknown>>(),
  shared:
    vi.fn<(db: unknown, ownerId: string, id: string) => Promise<string[]>>(),
  assignedByMe: vi.fn<(db: unknown, coachId: string) => Promise<Set<string>>>(),
  personalNotes:
    vi.fn<(db: unknown, ownerId: string, id: string) => Promise<unknown>>(),
  coachNotes:
    vi.fn<(db: unknown, ownerId: string, id: string) => Promise<unknown>>(),
  forkNotes:
    vi.fn<(db: unknown, ownerId: string, id: string) => Promise<unknown>>(),
  training: vi.fn<(account: unknown, id: string) => Promise<unknown>>(),
}));

// The owner-filtered read: the db returns nothing for a repertoire the
// account does not own, one only assigned to it included.
vi.mock('@mychess/db', () => ({
  listRepertoires: server.list,
  coachAssignments: server.assignments,
  loadRepertoire: server.load,
  playerCoaches: server.coaches,
  sharedCoachIds: server.shared,
  assignedByMe: server.assignedByMe,
  listPersonalNotes: server.personalNotes,
  coachNotesOn: server.coachNotes,
  forkCoachNotesOn: server.forkNotes,
}));
// Which counts it reads, and for whom, is the training loader's own test.
vi.mock('./training', () => ({ repertoireTraining: server.training }));
vi.mock('./db', () => ({ getDb: () => DB }));
// The session account; requireOnboarded's redirects are session.ts's own.
vi.mock('./session', () => ({ requireOnboarded: server.account }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new NotFound();
  },
}));

const ITEMS: RepertoireListItem[] = [
  {
    id: LONDON,
    side: 'white',
    name: 'Londono sistema',
    chapters: 2,
    moves: 21,
    updatedAt: NOW,
    forkedFrom: null,
  },
  {
    id: FORK,
    side: 'black',
    name: 'Karo-Kan gynyba',
    chapters: 4,
    moves: 96,
    updatedAt: NOW,
    forkedFrom: { repertoireId: LONDON, coachName: 'Jonas' },
  },
];

/** An assignment row of the coach's, reaching `playerIds`. */
const rowReaching = (id: string, playerIds: readonly string[]) => ({
  id,
  target: { kind: 'group', id, name: 'Grupė' },
  deadline: null,
  players: playerIds.map((playerId) => ({ playerId, displayName: playerId })),
});

beforeEach(() => {
  server.list.mockReset().mockResolvedValue(ITEMS);
  // London: a group of three, and one of them on their own too.
  server.assignments
    .mockReset()
    .mockImplementation((_db, _coach, id) =>
      Promise.resolve(
        id === LONDON
          ? [
              rowReaching('row-1', ['ona', 'rokas', 'tomas']),
              rowReaching('row-2', ['ona']),
            ]
          : [],
      ),
    );
  // London is assigned to three players (R-230's teaching material).
  server.assignedByMe.mockReset().mockResolvedValue(new Set([LONDON]));
});

describe('myRepertoires', () => {
  it("lists the session account's own repertoires, a fork named by its coach", async () => {
    server.account.mockResolvedValue({ id: 'rokas', coachSince: null });
    expect(await myRepertoires()).toEqual([
      {
        id: LONDON,
        side: 'white',
        name: 'Londono sistema',
        chapters: 2,
        moves: 21,
        updatedAt: NOW,
        forkCoachName: null,
        assignedTo: 0,
        teaching: false,
      },
      {
        id: FORK,
        side: 'black',
        name: 'Karo-Kan gynyba',
        chapters: 4,
        moves: 96,
        updatedAt: NOW,
        forkCoachName: 'Jonas',
        assignedTo: 0,
        teaching: false,
      },
    ]);
    expect(server.list).toHaveBeenCalledExactlyOnceWith(DB, 'rokas');
  });

  it('reads no assignee count nor assignment for an account that is not a coach', async () => {
    server.account.mockResolvedValue({ id: 'rokas', coachSince: null });
    await myRepertoires();
    expect(server.assignments).not.toHaveBeenCalled();
    expect(server.assignedByMe).not.toHaveBeenCalled();
  });

  it("marks a coach's repertoire assigned to anyone as teaching material, one assigned only to an empty group included (R-230)", async () => {
    server.account.mockResolvedValue({ id: 'jonas', coachSince: NOW });
    const GROUP_ONLY = '5e2d9c1a-7b3f-4a6e-8c0d-1f2e3a4b5c6d';
    server.list.mockResolvedValue([
      ...ITEMS,
      {
        id: GROUP_ONLY,
        side: 'white',
        name: 'Italų partija',
        chapters: 1,
        moves: 12,
        updatedAt: NOW,
        forkedFrom: null,
      },
    ]);
    // London is with three players; the Italian only with a group that has
    // no members yet, so no player has it but it is assigned.
    server.assignedByMe.mockResolvedValue(new Set([LONDON, GROUP_ONLY]));
    const items = await myRepertoires();
    expect(
      items.map((item) => [item.id, item.assignedTo, item.teaching]),
    ).toEqual([
      [LONDON, 3, true],
      [FORK, 0, false],
      [GROUP_ONLY, 0, true],
    ]);
    expect(server.assignedByMe).toHaveBeenCalledExactlyOnceWith(DB, 'jonas');
  });

  it("gives a coach's repertoire how many distinct players it reaches, read only for the assigned ones (R-225)", async () => {
    server.account.mockResolvedValue({ id: 'jonas', coachSince: NOW });
    const items = await myRepertoires();
    expect(items.map((item) => [item.id, item.assignedTo])).toEqual([
      [LONDON, 3],
      [FORK, 0],
    ]);
    // The session coach's id, never one from the request; the fork is not
    // assigned, so nothing is read for it.
    expect(server.assignments.mock.calls).toEqual([
      [DB, 'jonas', LONDON, expect.any(Date)],
    ]);
  });

  it('counts a player who forked it, as the teaching fact does: the forked Najdorf is teaching material, assigned to 1 (#381)', async () => {
    server.account.mockResolvedValue({ id: 'jonas', coachSince: NOW });
    const NAJDORF = '3c9e1b7a-2d4f-4e6a-9b8c-0a1b2c3d4e5f';
    server.list.mockResolvedValue([
      {
        id: NAJDORF,
        side: 'black',
        name: 'Najdorf',
        chapters: 3,
        moves: 40,
        updatedAt: NOW,
        forkedFrom: null,
      },
    ]);
    server.assignedByMe.mockResolvedValue(new Set([NAJDORF]));
    // Its one player forked it: no longer live, still reached by the row.
    server.assignments.mockResolvedValue([
      {
        ...rowReaching('row-1', []),
        players: [
          {
            playerId: 'rokas',
            displayName: 'Rokas',
            status: {
              deadline: null,
              overdue: false,
              paused: false,
              done: false,
              forked: true,
            },
          },
        ],
      },
    ]);
    const items = await myRepertoires();
    expect(
      items.map((item) => [item.id, item.assignedTo, item.teaching]),
    ).toEqual([[NAJDORF, 1, true]]);
  });
});

describe('importTargets', () => {
  it('offers the session account’s own repertoires by id, name and side, counting no assignees', async () => {
    server.account.mockResolvedValue({ id: 'jonas', coachSince: NOW });
    expect(await importTargets()).toEqual([
      { id: LONDON, name: 'Londono sistema', side: 'white' },
      { id: FORK, name: 'Karo-Kan gynyba', side: 'black' },
    ]);
    expect(server.list).toHaveBeenCalledExactlyOnceWith(DB, 'jonas');
    expect(server.assignments).not.toHaveBeenCalled();
  });
});

/** Rokas's own London as the owner-filtered read gives it. */
const OWN: LoadedRepertoire = {
  repertoire: {
    id: LONDON,
    ownerId: 'rokas',
    side: 'white',
    name: 'Londono sistema',
    version: 2,
    createdAt: NOW,
    updatedAt: NOW,
  },
  graph: graphOf(LONDON_PGN),
};

describe('repertoireManageData', () => {
  beforeEach(() => {
    server.account.mockResolvedValue({ id: 'rokas', coachSince: null });
    server.load.mockReset().mockResolvedValue(OWN);
    server.coaches
      .mockReset()
      .mockResolvedValue([{ id: 'c-1', displayName: 'Dovydas', extra: 1 }]);
    server.shared.mockReset().mockResolvedValue(['c-1']);
  });

  it('reads the session account’s own repertoire for them: its id and name, and its sharing', async () => {
    expect(await repertoireManageData(LONDON)).toEqual({
      repertoire: { id: LONDON, name: 'Londono sistema' },
      sharing: {
        coaches: [{ id: 'c-1', displayName: 'Dovydas' }],
        sharedWith: ['c-1'],
      },
    });
    expect(server.load).toHaveBeenCalledWith(DB, LONDON, 'rokas');
    expect(server.coaches).toHaveBeenCalledWith(DB, 'rokas');
    expect(server.shared).toHaveBeenCalledWith(DB, 'rokas', LONDON);
  });

  it('is 404 for a malformed id, read nowhere', async () => {
    await expect(repertoireManageData('not-a-uuid')).rejects.toBeInstanceOf(
      NotFound,
    );
    expect(server.load).not.toHaveBeenCalled();
    expect(server.shared).not.toHaveBeenCalled();
  });

  it('is 404 for a repertoire the account only has by assignment, reading no sharing', async () => {
    server.load.mockResolvedValue(undefined);
    await expect(repertoireManageData(LONDON)).rejects.toBeInstanceOf(NotFound);
    expect(server.shared).not.toHaveBeenCalled();
  });

  it('is 404 when the domain refuses a repertoire someone else owns', async () => {
    server.load.mockResolvedValue({
      ...OWN,
      repertoire: { ...OWN.repertoire, ownerId: 'gabija' },
    });
    await expect(repertoireManageData(LONDON)).rejects.toBeInstanceOf(NotFound);
    expect(server.shared).not.toHaveBeenCalled();
  });
});

describe('repertoirePageData', () => {
  const ROKAS = { id: 'rokas', coachSince: null };
  const TRAINING = { standing: { kind: 'notStarted' }, trainable: null };
  const NOTE = {
    coachId: 'c-1',
    coachName: 'Dovydas',
    moveKey: 'k',
    text: 'Hi',
  };

  beforeEach(() => {
    server.account.mockReset().mockResolvedValue(ROKAS);
    server.load.mockReset().mockResolvedValue(OWN);
    server.personalNotes.mockReset().mockResolvedValue([]);
    server.coachNotes
      .mockReset()
      .mockResolvedValue([{ ...NOTE, updatedAt: NOW }]);
    server.forkNotes.mockReset().mockResolvedValue([]);
    server.training.mockReset().mockResolvedValue(TRAINING);
  });

  it('gives the page all it shows, the session account’s training of it included, authenticating once (R-142)', async () => {
    const data = await repertoirePageData(LONDON);
    expect(data.repertoire).toMatchObject({ id: LONDON, version: 2 });
    expect(data.coachNotes).toEqual([NOTE]);
    expect(data.forkNotes).toEqual([]);
    expect(data.training).toBe(TRAINING);
    expect(server.training).toHaveBeenCalledExactlyOnceWith(ROKAS, LONDON);
    expect(server.account).toHaveBeenCalledOnce();
  });

  it('is 404 for a repertoire the account may not view, reading no training', async () => {
    server.load.mockResolvedValue(undefined);
    await expect(repertoirePageData(LONDON)).rejects.toBeInstanceOf(NotFound);
    expect(server.training).not.toHaveBeenCalled();
  });
});
