import type {
  CoachInvite,
  CoachStatus,
  DashboardPlayer,
  GroupPage,
  GroupProgressCell,
  LinkedAccount,
  PlayerProgress,
  ProgressRow,
} from '@mychess/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  coachDashboardData,
  coachGroupData,
  coachPlayerData,
  sharedRepertoireData,
} from './coach-pages';

// The loaders' reads against a real database, and their access checks,
// are covered by the feature suite; this covers how each page makes its
// one read and what it makes of it.
const DB = { name: 'the db' };
// 10:00 in Vilnius on 20 October.
const NOW = new Date('2026-10-20T07:00:00Z');
// 23:30 in Vilnius on 18 October, 20:30 UTC: two Vilnius days before NOW.
const TWO_DAYS_AGO = new Date('2026-10-18T20:30:00Z');
const JONAS = { id: 'jonas' };
const GROUP = '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10';

const server = vi.hoisted(() => ({
  coach: vi.fn<() => Promise<unknown>>(),
  home: vi.fn<(...args: unknown[]) => Promise<DashboardPlayer[]>>(),
  groups: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(),
  invites: vi.fn<(...args: unknown[]) => Promise<CoachInvite[]>>(),
  player: vi.fn<(...args: unknown[]) => Promise<PlayerProgress | undefined>>(),
  group: vi.fn<(...args: unknown[]) => Promise<GroupPage | undefined>>(),
  snapshot: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  assertSees: vi.fn<(...args: unknown[]) => void>(),
}));

vi.mock('@mychess/db', () => ({
  coachDashboard: server.home,
  coachGroups: server.groups,
  coachInvites: server.invites,
  coachPlayerProgress: server.player,
  coachGroupPage: server.group,
  sharedRepertoireSnapshot: server.snapshot,
}));
vi.mock('./coaching', () => ({
  requireCoach: server.coach,
  assertCoachMaySeeBy: server.assertSees,
}));
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
const STATUS = {
  deadline: '2026-10-20',
  overdue: true,
  paused: false,
  done: false,
  forked: false,
};
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
  status: STATUS,
  view: GRANTED,
};
const SHARED: ProgressRow = {
  repertoire: TAIMANOV,
  source: 'shared',
  badges: null,
  status: null,
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

describe('coachDashboardData', () => {
  it('gives each player their summary and the Vilnius days since they last trained, in one read', async () => {
    // 23:30 in Vilnius on 19 October: yesterday.
    server.home.mockResolvedValue([
      {
        ...ROKAS,
        lastTrained: new Date('2026-10-19T20:30:00Z'),
        rows: [ASSIGNED, SHARED],
      },
      { ...GABIJA, lastTrained: null, rows: [] },
    ]);
    const dashboard = await coachDashboardData();
    expect(dashboard.players).toEqual([
      {
        id: 'rokas',
        displayName: 'Rokas',
        lastTrainedDays: 1,
        summary: {
          counts: { notStarted: 2, skipped: 4, due: 6, learned: 8 },
          nextDeadline: '2026-10-20',
          allDone: false,
          overdue: true,
        },
      },
      {
        id: 'gabija',
        displayName: 'Gabija',
        lastTrainedDays: null,
        summary: {
          counts: null,
          nextDeadline: null,
          allDone: false,
          overdue: false,
        },
      },
    ]);
    expect(dashboard.today).toBe('2026-10-20');
    // As of now: overdue is judged at the clock.
    expect(server.home).toHaveBeenCalledExactlyOnceWith(DB, 'jonas', NOW);
  });

  it('lists who needs attention, most urgent reason first, then by name (R-229)', async () => {
    const pile: ProgressRow = {
      ...SHARED,
      view: {
        kind: 'granted',
        standing: { counts: { ...COUNTS, due: 30 }, mastered: false },
      },
    };
    const late: ProgressRow = {
      ...ASSIGNED,
      status: { ...STATUS, deadline: '2026-10-18' },
    };
    server.home.mockResolvedValue([
      { ...account('ausra', 'Aušra'), lastTrained: NOW, rows: [SHARED] },
      { ...GABIJA, lastTrained: null, rows: [pile] },
      { ...ROKAS, lastTrained: NOW, rows: [late] },
    ]);
    expect((await coachDashboardData()).attention).toEqual([
      {
        player: { id: 'rokas', displayName: 'Rokas' },
        reason: { kind: 'overdue', repertoires: ['Londono sistema'], days: 2 },
      },
      {
        player: { id: 'gabija', displayName: 'Gabija' },
        reason: { kind: 'duePile', due: 30 },
      },
    ]);
  });

  it('counts a never-trained player idle from the link (R-229)', async () => {
    const open: ProgressRow = {
      ...ASSIGNED,
      status: { ...STATUS, deadline: null, overdue: false },
    };
    server.home.mockResolvedValue([
      {
        ...ROKAS,
        linkedAt: new Date('2026-10-10T07:00:00Z'),
        lastTrained: null,
        rows: [open],
      },
    ]);
    expect((await coachDashboardData()).attention).toEqual([
      {
        player: { id: 'rokas', displayName: 'Rokas' },
        reason: { kind: 'idle', days: 10, since: 'link' },
      },
    ]);
  });

  it('gives today as the Vilnius day, the next one from 21:00 UTC', async () => {
    // 23:30 UTC on 20 October is 02:30 on 21 October in Vilnius.
    vi.setSystemTime(new Date('2026-10-20T23:30:00Z'));
    server.home.mockResolvedValue([]);
    expect((await coachDashboardData()).today).toBe('2026-10-21');
  });

  it('gives the coach’s groups with their assignments as the read has them', async () => {
    const group = {
      id: GROUP,
      name: 'Šeštadienio grupė',
      memberCount: 2,
      createdAt: NOW,
      assignments: [
        {
          repertoireId: LONDON.id,
          repertoireName: LONDON.name,
          deadline: '2026-11-30',
        },
      ],
    };
    server.home.mockResolvedValue([]);
    server.groups.mockResolvedValue([group]);
    const dashboard = await coachDashboardData();
    expect(dashboard.groups).toEqual([group]);
    expect(dashboard.attention).toEqual([]);
    expect(server.groups).toHaveBeenCalledExactlyOnceWith(DB, 'jonas');
  });

  it('takes the nearest open deadline of the live assignments, never a forked one’s (R-155)', async () => {
    const row = (
      name: string,
      status: Partial<CoachStatus>,
      view: ProgressRow['view'] = GRANTED,
    ): ProgressRow => ({
      ...ASSIGNED,
      repertoire: { ...LONDON, name },
      status: { ...STATUS, overdue: false, ...status },
      view,
    });
    server.home.mockResolvedValue([
      {
        ...ROKAS,
        lastTrained: null,
        rows: [
          row('Done', { deadline: '2026-10-21', done: true }),
          row(
            'Forked',
            { deadline: '2026-10-22', forked: true, overdue: true },
            { kind: 'forked', sharedForkId: null },
          ),
          row('Later', { deadline: '2026-11-30' }),
          row('Sooner', { deadline: '2026-10-25' }),
          row('None', { deadline: null }),
        ],
      },
    ]);
    expect((await coachDashboardData()).players).toMatchObject([
      {
        summary: {
          // The four granted rows; the forked one has no counts.
          counts: { notStarted: 4, skipped: 8, due: 12, learned: 16 },
          nextDeadline: '2026-10-25',
          overdue: false,
        },
      },
    ]);
  });

  it('lists the open personal invites with their dates, leaving group invites to their groups (R-232)', async () => {
    const MADE = new Date('2026-10-13T07:00:00Z');
    const EXPIRES = new Date('2026-10-27T07:00:00Z');
    const invite = (
      id: string,
      kind: CoachInvite['kind'],
      groupId: string | null,
    ): CoachInvite => ({
      id,
      kind,
      groupId,
      groupName: groupId === null ? null : 'Šeštadienio grupė',
      createdAt: MADE,
      expiresAt: EXPIRES,
    });
    server.home.mockResolvedValue([]);
    server.invites.mockResolvedValue([
      invite('i-1', 'personal', null),
      invite('i-2', 'group', GROUP),
      invite('i-3', 'personal', null),
    ]);
    expect((await coachDashboardData()).personalInvites).toEqual([
      { id: 'i-1', createdAt: MADE, expiresAt: EXPIRES },
      { id: 'i-3', createdAt: MADE, expiresAt: EXPIRES },
    ]);
    // Open at the clock: none used, expired or revoked (#329).
    expect(server.invites).toHaveBeenCalledExactlyOnceWith(DB, 'jonas', NOW);
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
  const cell: GroupProgressCell = {
    badges: BADGES,
    status: STATUS,
    view: { kind: 'forked', sharedForkId: null },
  };

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
      invite: null,
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

describe('sharedRepertoireData', () => {
  const FACTS = { linked: true, sharedRepertoireIds: new Set([TAIMANOV.id]) };
  /** Rokas's Taimanov as the snapshot reads it, a Fork of `forkOf` or none. */
  const snapshotOf = (forkOf: string | null) => ({
    facts: FACTS,
    player: ROKAS,
    shared: {
      repertoire: TAIMANOV,
      graph: { side: 'black', chapters: [], moves: [] },
      notes: [{ moveKey: 'k|e4', text: 'Pirmiau Nf3' }],
    },
    forkOf,
  });

  beforeEach(() => {
    server.snapshot.mockReset();
    server.assertSees.mockReset();
  });

  it('reads one snapshot, lets the domain decide on its facts, and gives the coach’s own notes', async () => {
    server.snapshot.mockResolvedValue(snapshotOf(null));
    const page = await sharedRepertoireData('rokas', TAIMANOV.id);
    expect(server.snapshot).toHaveBeenCalledExactlyOnceWith(
      DB,
      'jonas',
      'rokas',
      TAIMANOV.id,
    );
    expect(server.assertSees).toHaveBeenCalledExactlyOnceWith(
      JONAS,
      'rokas',
      { kind: 'repertoire', repertoireId: TAIMANOV.id },
      FACTS,
    );
    expect(page).toMatchObject({
      player: { id: 'rokas', displayName: 'Rokas' },
      repertoire: TAIMANOV,
      notes: { 'k|e4': 'Pirmiau Nf3' },
      isFork: false,
    });
    expect(page).not.toHaveProperty('forkOf');
  });

  it('says a shared Fork is the player’s own copy, as the snapshot names it, without the coach’s id (R-155)', async () => {
    server.snapshot.mockResolvedValue(snapshotOf(LONDON.id));
    const page = await sharedRepertoireData('rokas', TAIMANOV.id);
    expect(page.isFork).toBe(true);
    expect(JSON.stringify(page)).not.toContain(LONDON.id);
  });

  it('is 404 when nothing is shared, and for a malformed id without reading', async () => {
    server.snapshot.mockResolvedValue({
      ...snapshotOf(null),
      shared: undefined,
    });
    await expect(sharedRepertoireData('rokas', TAIMANOV.id)).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
    server.snapshot.mockClear();
    await expect(sharedRepertoireData('rokas', 'nope')).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
    expect(server.snapshot).not.toHaveBeenCalled();
  });
});
