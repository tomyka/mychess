import type { CoachAssignment } from '@mychess/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { coachAssignData } from './coach-assignments';

const ID = '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10';
const GROUP = '0b9e7a51-3c2d-4e6f-8a1b-2c3d4e5f6a7b';
const DB = { name: 'the db' };
const NOW = new Date('2026-10-20T08:00:00Z');

const server = vi.hoisted(() => ({
  account: vi.fn<() => Promise<unknown>>(),
  assignments: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  count: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  players: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  groups: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));

vi.mock('@mychess/db', () => ({
  coachAssignments: server.assignments,
  assignedPlayerCount: server.count,
  coachPlayers: server.players,
  coachGroups: server.groups,
}));

vi.mock('./db', () => ({ getDb: () => DB }));

// The session account; requireOnboarded's redirects are session.ts's own.
vi.mock('./session', () => ({ requireOnboarded: server.account }));

const JONAS = { id: 'jonas', coachSince: NOW };

const ASSIGNMENT: CoachAssignment = {
  id: 'a-1',
  target: { kind: 'player', id: 'rokas', name: 'Rokas' },
  deadline: null,
  players: [],
};

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  server.account.mockReset().mockResolvedValue(JONAS);
  server.assignments.mockReset().mockResolvedValue([ASSIGNMENT]);
  server.count.mockReset().mockResolvedValue(3);
  server.players.mockReset().mockResolvedValue([
    {
      id: 'rokas',
      displayName: 'Rokas',
      linkedAt: NOW,
      groups: [{ id: GROUP, name: 'Šeštadienio grupė' }],
    },
  ]);
  server.groups.mockReset().mockResolvedValue([
    {
      id: GROUP,
      name: 'Šeštadienio grupė',
      memberCount: 1,
      createdAt: NOW,
    },
  ]);
  return () => {
    vi.useRealTimers();
  };
});

describe('coachAssignData', () => {
  it('reads the session coach’s assignments, players and groups', async () => {
    expect(await coachAssignData(ID)).toEqual({
      assignedPlayers: 3,
      // Rokas has it already: only the group is offered.
      panel: {
        players: [],
        groups: [{ id: GROUP, name: 'Šeštadienio grupė' }],
        assignments: [ASSIGNMENT],
      },
    });
    expect(server.assignments).toHaveBeenCalledWith(DB, 'jonas', ID, NOW);
    expect(server.count).toHaveBeenCalledWith(DB, 'jonas', ID);
    expect(server.players).toHaveBeenCalledWith(DB, 'jonas');
    expect(server.groups).toHaveBeenCalledWith(DB, 'jonas');
  });

  it('offers only the players and groups it is not yet assigned to', async () => {
    server.players.mockResolvedValue([
      { id: 'rokas', displayName: 'Rokas', linkedAt: NOW, groups: [] },
      { id: 'egle', displayName: 'Eglė', linkedAt: NOW, groups: [] },
    ]);
    server.assignments.mockResolvedValue([
      ASSIGNMENT,
      {
        id: 'a-2',
        target: { kind: 'group', id: GROUP, name: 'Šeštadienio grupė' },
        deadline: null,
        players: [],
      },
    ]);
    const data = await coachAssignData(ID);
    expect(data.panel?.players).toEqual([{ id: 'egle', displayName: 'Eglė' }]);
    expect(data.panel?.groups).toEqual([]);
    expect(data.panel?.assignments).toHaveLength(2);
  });

  it('has no panel with Coach mode off, but still counts the players', async () => {
    server.account.mockResolvedValue({ id: 'rokas', coachSince: null });
    expect(await coachAssignData(ID)).toEqual({
      assignedPlayers: 3,
      panel: null,
    });
    expect(server.count).toHaveBeenCalledWith(DB, 'rokas', ID);
    expect(server.assignments).not.toHaveBeenCalled();
    expect(server.players).not.toHaveBeenCalled();
    expect(server.groups).not.toHaveBeenCalled();
  });
});
