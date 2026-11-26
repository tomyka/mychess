import type { RepertoireListItem } from '@mychess/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { myRepertoires } from './repertoires';

const LONDON = '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10';
const FORK = '0b6c2a4e-1f3d-4e5a-8b7c-9d0e1f2a3b4c';
const DB = { name: 'the db' };
const NOW = new Date('2026-10-20T08:00:00Z');

const server = vi.hoisted(() => ({
  account: vi.fn<() => Promise<unknown>>(),
  list: vi.fn<(db: unknown, ownerId: string) => Promise<unknown>>(),
  count:
    vi.fn<
      (db: unknown, coachId: string, repertoireId: string) => Promise<number>
    >(),
}));

vi.mock('@mychess/db', () => ({
  listRepertoires: server.list,
  assignedPlayerCount: server.count,
}));
vi.mock('./db', () => ({ getDb: () => DB }));
// The session account; requireOnboarded's redirects are session.ts's own.
vi.mock('./session', () => ({ requireOnboarded: server.account }));

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
