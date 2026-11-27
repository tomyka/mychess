import type {
  AssigneeStanding,
  CoachAssignment,
  RepertoireAssignees,
} from '@mychess/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { coachAssignData } from './coach-assignments';

const ID = '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10';
const GROUP = '0b9e7a51-3c2d-4e6f-8a1b-2c3d4e5f6a7b';
const DB = { name: 'the db' };
const NOW = new Date('2026-10-20T08:00:00Z');

const server = vi.hoisted(() => ({
  account: vi.fn<() => Promise<unknown>>(),
  assignees:
    vi.fn<
      (
        db: unknown,
        request: { readonly coachId: string; readonly repertoireId: string },
        now: Date,
      ) => Promise<unknown>
    >(),
  players: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  groups: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));

vi.mock('@mychess/db', () => ({
  repertoireAssignees: server.assignees,
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

/** What the one read returns: `assignments`, no standings, 3 live of 4. */
const read = (
  assignments: readonly CoachAssignment[],
  standings: ReadonlyMap<string, AssigneeStanding | null> = new Map(),
): RepertoireAssignees => ({
  assignments,
  standings,
  livePlayers: 3,
  assignees: 4,
});

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  server.account.mockReset().mockResolvedValue(JONAS);
  server.assignees.mockReset().mockResolvedValue(read([ASSIGNMENT]));
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
  it('reads the session coach’s assignments in one read, then their players and groups', async () => {
    expect(await coachAssignData(ID)).toEqual({
      // The live players, for the delete dialog (R-131).
      assignedPlayers: 3,
      // Rokas has it already: only the group is offered.
      panel: {
        players: [],
        groups: [{ id: GROUP, name: 'Šeštadienio grupė' }],
        assignments: [ASSIGNMENT],
        // Today in Vilnius, the date fields' earliest day (R-203).
        today: '2026-10-20',
        standings: new Map(),
      },
    });
    expect(server.assignees).toHaveBeenCalledExactlyOnceWith(
      DB,
      { coachId: 'jonas', repertoireId: ID },
      NOW,
    );
    expect(server.players).toHaveBeenCalledWith(DB, 'jonas');
    expect(server.groups).toHaveBeenCalledWith(DB, 'jonas');
  });

  it('offers only the players and groups it is not yet assigned to', async () => {
    server.players.mockResolvedValue([
      { id: 'rokas', displayName: 'Rokas', linkedAt: NOW, groups: [] },
      { id: 'egle', displayName: 'Eglė', linkedAt: NOW, groups: [] },
    ]);
    server.assignees.mockResolvedValue(
      read([
        ASSIGNMENT,
        {
          id: 'a-2',
          target: { kind: 'group', id: GROUP, name: 'Šeštadienio grupė' },
          deadline: null,
          players: [],
        },
      ]),
    );
    const data = await coachAssignData(ID);
    expect(data.panel?.players).toEqual([
      { id: 'egle', displayName: 'Eglė', viaGroups: [] },
    ]);
    expect(data.panel?.groups).toEqual([]);
    expect(data.panel?.assignments).toHaveLength(2);
  });

  it('says through which assigned groups a still-offered player has it (R-134)', async () => {
    const reaches = (
      playerId: string,
      displayName: string,
      forked = false,
    ) => ({
      playerId,
      displayName,
      deadline: null,
      status: {
        deadline: null,
        overdue: false,
        paused: false,
        done: false,
        forked,
      },
    });
    server.players.mockResolvedValue([
      { id: 'egle', displayName: 'Eglė', linkedAt: NOW, groups: [] },
      { id: 'marta', displayName: 'Marta', linkedAt: NOW, groups: [] },
      { id: 'rokas', displayName: 'Rokas', linkedAt: NOW, groups: [] },
    ]);
    server.assignees.mockResolvedValue(
      read([
        // Rokas's own assignment names no group, and he is not offered.
        { ...ASSIGNMENT, players: [reaches('rokas', 'Rokas')] },
        {
          id: 'a-2',
          target: { kind: 'group', id: GROUP, name: 'U1600' },
          deadline: null,
          players: [reaches('egle', 'Eglė'), reaches('rokas', 'Rokas')],
        },
        {
          id: 'a-3',
          target: { kind: 'group', id: 'g-2', name: 'Juniors' },
          deadline: null,
          // Marta forked her copy: Juniors no longer reaches her (lead decision).
          players: [reaches('egle', 'Eglė'), reaches('marta', 'Marta', true)],
        },
      ]),
    );
    const data = await coachAssignData(ID);
    // Eglė stays assignable, her groups in name order (R-160).
    expect(data.panel?.players).toEqual([
      { id: 'egle', displayName: 'Eglė', viaGroups: ['Juniors', 'U1600'] },
      { id: 'marta', displayName: 'Marta', viaGroups: [] },
    ]);
  });

  it('passes each assigned player’s standing and status on as the read gave them (R-225, R-231)', async () => {
    const status = {
      deadline: '2026-10-30',
      overdue: false,
      paused: false,
      done: false,
      forked: false,
    };
    const standings = new Map([
      [
        'rokas',
        {
          standing: {
            counts: { notStarted: 4, skipped: 0, due: 1, learned: 5 },
            mastered: false,
          },
          status,
        },
      ],
      // Marta made her own copy: no standing for the coach (R-155).
      ['marta', null],
    ]);
    server.assignees.mockResolvedValue(read([ASSIGNMENT], standings));
    const data = await coachAssignData(ID);
    expect(data.panel?.standings).toBe(standings);
  });

  it('has no panel with Coach mode off, but still counts the live players', async () => {
    server.account.mockResolvedValue({ id: 'rokas', coachSince: null });
    expect(await coachAssignData(ID)).toEqual({
      assignedPlayers: 3,
      panel: null,
    });
    expect(server.assignees).toHaveBeenCalledExactlyOnceWith(
      DB,
      { coachId: 'rokas', repertoireId: ID },
      NOW,
    );
    expect(server.players).not.toHaveBeenCalled();
    expect(server.groups).not.toHaveBeenCalled();
  });
});
