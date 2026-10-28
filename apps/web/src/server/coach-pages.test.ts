import type {
  GroupPage,
  GroupProgressCell,
  HomePlayer,
  LinkedAccount,
  PlayerProgress,
  ProgressRow,
} from '@mychess/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { coachHomeData, coachPlayerData, coachGroupData } from './coach-pages';

// The loaders' reads against a real database, and their access checks,
// are covered by the feature suite; this covers how each page makes its
// one read and what it makes of it.
const DB = { name: 'the db' };
// 10:00 in Vilnius on 20 October.
const NOW = new Date('2026-10-20T07:00:00Z');
// 23:30 in Vilnius on 18 October, 20:30 UTC: two Vilnius days before NOW.
const TWO_DAYS_AGO = new Date('2026-10-18T20:30:00Z');
const JONAS = { id: 'jonas', locale: 'lt' };
const GROUP = '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10';

const server = vi.hoisted(() => ({
  coach: vi.fn<() => Promise<unknown>>(),
  home: vi.fn<(...args: unknown[]) => Promise<HomePlayer[]>>(),
  groups: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(),
  invites: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(),
  player: vi.fn<(...args: unknown[]) => Promise<PlayerProgress | undefined>>(),
  group: vi.fn<(...args: unknown[]) => Promise<GroupPage | undefined>>(),
}));

vi.mock('@mychess/db', () => ({
  coachHomePlayers: server.home,
  coachGroups: server.groups,
  coachInvites: server.invites,
  coachPlayerProgress: server.player,
  coachGroupPage: server.group,
}));
vi.mock('./coaching', () => ({ requireCoach: server.coach }));
vi.mock('./db', () => ({ getDb: () => DB }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

const account = (id: string, displayName: string): LinkedAccount => ({
  id,
  displayName,
  linkedAt: NOW,
  groups: [],
});
const ROKAS = account('rokas', 'Rokas');
const GABIJA = account('gabija', 'Gabija');

const COUNTS = { notStarted: 1, skipped: 2, due: 3, learned: 4 };
const BADGES = { overdue: true, paused: false, forked: false, updated: false };
const LONDON = {
  id: '0b9e7c1e-3f4a-4c5b-8d6e-7f8091a2b3c4',
  name: 'Londono sistema',
  side: 'white',
} as const;
const TAIMANOV = {
  id: '1c9e7c1e-3f4a-4c5b-8d6e-7f8091a2b3c5',
  name: 'Taimanovas',
  side: 'black',
} as const;
const GRANTED = {
  kind: 'granted',
  standing: { counts: COUNTS, mastered: false },
} as const;
const ASSIGNED: ProgressRow = {
  repertoire: LONDON,
  source: 'assigned',
  badges: BADGES,
  view: GRANTED,
};
const SHARED: ProgressRow = {
  repertoire: TAIMANOV,
  source: 'shared',
  badges: null,
  view: GRANTED,
};

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  server.coach.mockReset().mockResolvedValue(JONAS);
  server.home.mockReset();
  server.groups.mockReset().mockResolvedValue([]);
  server.invites.mockReset().mockResolvedValue([]);
  server.player.mockReset();
  server.group.mockReset();
  return () => {
    vi.useRealTimers();
  };
});

describe('coachHomeData', () => {
  it('gives each player the Vilnius days since they last trained, in one read', async () => {
    // 23:30 in Vilnius on 19 October: yesterday.
    server.home.mockResolvedValue([
      { ...ROKAS, lastTrained: new Date('2026-10-19T20:30:00Z') },
      { ...GABIJA, lastTrained: null },
    ]);
    const home = await coachHomeData();
    expect(home.players).toEqual([
      { ...ROKAS, lastTrainedDays: 1 },
      { ...GABIJA, lastTrainedDays: null },
    ]);
    expect(server.home).toHaveBeenCalledExactlyOnceWith(DB, 'jonas');
  });
});

describe('coachPlayerData', () => {
  it('makes one read, as the session coach, of the parsed id at the clock', async () => {
    server.player.mockResolvedValue({
      player: ROKAS,
      rows: [ASSIGNED, SHARED],
      lastTrained: TWO_DAYS_AGO,
    });
    expect(await coachPlayerData('rokas')).toEqual({
      ...ROKAS,
      repertoires: [TAIMANOV],
      progress: { rows: [ASSIGNED, SHARED], lastTrainedDays: 2 },
    });
    expect(server.coach).toHaveBeenCalledOnce();
    expect(server.player).toHaveBeenCalledExactlyOnceWith(
      DB,
      'jonas',
      'rokas',
      NOW,
    );
  });

  it('lists as shared only the rows the player shares, and keeps never trained as null', async () => {
    server.player.mockResolvedValue({
      player: ROKAS,
      rows: [ASSIGNED],
      lastTrained: null,
    });
    expect(await coachPlayerData('rokas')).toMatchObject({
      repertoires: [],
      progress: { rows: [ASSIGNED], lastTrainedDays: null },
    });
  });

  it('is 404 when the read refuses (not linked, or the link went)', async () => {
    server.player.mockResolvedValue(undefined);
    await expect(coachPlayerData('rokas')).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('is 404 for a malformed id without reading', async () => {
    await expect(coachPlayerData('')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(server.player).not.toHaveBeenCalled();
  });
});

describe('coachGroupData', () => {
  const cell: GroupProgressCell = { badges: BADGES, view: { kind: 'forked' } };

  it('reads the session coach’s group once and turns last trained into Vilnius days ago', async () => {
    server.group.mockResolvedValue({
      group: {
        id: GROUP,
        name: 'Šeštadienio grupė',
        createdAt: NOW,
        members: [
          { id: 'rokas', displayName: 'Rokas', joinedAt: NOW },
          { id: 'gabija', displayName: 'Gabija', joinedAt: NOW },
        ],
      },
      addable: [{ id: 'ruta', displayName: 'Rūta' }],
      grid: {
        columns: [LONDON],
        rows: [
          {
            player: { id: 'rokas', displayName: 'Rokas' },
            lastTrained: NOW,
            cells: [cell],
          },
          {
            player: { id: 'gabija', displayName: 'Gabija' },
            lastTrained: null,
            cells: [null],
          },
        ],
      },
    });
    expect(await coachGroupData(GROUP)).toEqual({
      id: GROUP,
      name: 'Šeštadienio grupė',
      createdAt: NOW,
      members: [
        { id: 'rokas', displayName: 'Rokas', joinedAt: NOW },
        { id: 'gabija', displayName: 'Gabija', joinedAt: NOW },
      ],
      addable: [{ id: 'ruta', displayName: 'Rūta' }],
      grid: {
        columns: [LONDON],
        rows: [
          {
            player: { id: 'rokas', displayName: 'Rokas' },
            lastTrainedDays: 0,
            cells: [cell],
          },
          {
            player: { id: 'gabija', displayName: 'Gabija' },
            lastTrainedDays: null,
            cells: [null],
          },
        ],
      },
    });
    expect(server.coach).toHaveBeenCalledOnce();
    expect(server.group).toHaveBeenCalledExactlyOnceWith(
      DB,
      'jonas',
      GROUP,
      NOW,
    );
  });

  it('is 404 for a malformed group id without reading', async () => {
    await expect(coachGroupData('nope')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(server.group).not.toHaveBeenCalled();
  });

  it('is 404 for any group but the coach’s own', async () => {
    server.group.mockResolvedValue(undefined);
    await expect(coachGroupData(GROUP)).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
