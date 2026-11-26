import type { LoadedRepertoire, RepertoireListItem } from '@mychess/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { graphOf, LONDON as LONDON_PGN } from '../../test/fixtures/repertoires';
import {
  importTargets,
  myRepertoires,
  repertoireManageData,
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
  count:
    vi.fn<
      (db: unknown, coachId: string, repertoireId: string) => Promise<number>
    >(),
  load: vi.fn<
    (db: unknown, id: string, viewerId: string) => Promise<unknown>
  >(),
  coaches: vi.fn<(db: unknown, ownerId: string) => Promise<unknown>>(),
  shared:
    vi.fn<(db: unknown, ownerId: string, id: string) => Promise<string[]>>(),
}));

// The owner-filtered read: the db returns nothing for a repertoire the
// account does not own, one only assigned to it included.
vi.mock('@mychess/db', () => ({
  listRepertoires: server.list,
  assignedPlayerCount: server.count,
  loadRepertoire: server.load,
  playerCoaches: server.coaches,
  sharedCoachIds: server.shared,
}));
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

beforeEach(() => {
  server.list.mockReset().mockResolvedValue(ITEMS);
  server.count
    .mockReset()
    .mockImplementation((_db, _coach, id) =>
      Promise.resolve(id === LONDON ? 3 : 0),
    );
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
      },
    ]);
    expect(server.list).toHaveBeenCalledExactlyOnceWith(DB, 'rokas');
  });

  it('reads no assignee count for an account that is not a coach', async () => {
    server.account.mockResolvedValue({ id: 'rokas', coachSince: null });
    await myRepertoires();
    expect(server.count).not.toHaveBeenCalled();
  });

  it("gives a coach's repertoire how many players have it assigned (R-225)", async () => {
    server.account.mockResolvedValue({ id: 'jonas', coachSince: NOW });
    const items = await myRepertoires();
    expect(items.map((item) => [item.id, item.assignedTo])).toEqual([
      [LONDON, 3],
      [FORK, 0],
    ]);
    // The session coach's id, never one from the request.
    expect(server.count.mock.calls).toEqual([
      [DB, 'jonas', LONDON],
      [DB, 'jonas', FORK],
    ]);
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
    expect(server.count).not.toHaveBeenCalled();
  });
});

describe('repertoireManageData', () => {
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
