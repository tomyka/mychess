import type { LinkedAccount, PlayerAssignment } from '@mychess/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { coachRows, myCoachesData } from './settings-page';

const DB = { db: 'settings' };

const server = vi.hoisted(() => ({
  coaches: vi.fn<(db: unknown, playerId: string) => Promise<LinkedAccount[]>>(),
  assignments:
    vi.fn<
      (db: unknown, playerId: string, now: Date) => Promise<PlayerAssignment[]>
    >(),
}));

vi.mock('@mychess/db', () => ({
  playerCoaches: server.coaches,
  playerAssignments: server.assignments,
}));
vi.mock('./db', () => ({ getDb: () => DB }));

const LINKED = new Date('2026-10-01T08:00:00Z');

const coach = (
  id: string,
  displayName: string,
  groups: LinkedAccount['groups'] = [],
): LinkedAccount => ({ id, displayName, linkedAt: LINKED, groups });

/** Repertoire `name` from coach `coachId`, on time and not paused unless said. */
const assignment = (
  coachId: string,
  name: string,
  over: Partial<PlayerAssignment> = {},
): PlayerAssignment => ({
  repertoireId: `r-${name}`,
  name,
  side: 'white',
  chapters: 1,
  moves: 10,
  coachId,
  coachName: `Coach ${coachId}`,
  deadline: null,
  paused: false,
  done: false,
  badges: { overdue: false, paused: false, updated: false },
  ...over,
});

const ON_TIME = {
  deadline: null,
  overdue: false,
  paused: false,
  done: false,
};

describe('coachRows (R-237)', () => {
  it('gives each coach its own assignments by name, and its groups', () => {
    const groups = [{ id: 'g1', name: 'Juniors 2026' }];
    expect(
      coachRows(
        [coach('c1', 'Rimantas V.', groups), coach('c2', 'Ona')],
        [
          assignment('c1', 'Najdorf'),
          assignment('c2', 'London'),
          assignment('c1', 'Alapin'),
        ],
      ),
    ).toEqual([
      {
        id: 'c1',
        displayName: 'Rimantas V.',
        groups,
        assignments: [
          { repertoireId: 'r-Alapin', name: 'Alapin', status: ON_TIME },
          { repertoireId: 'r-Najdorf', name: 'Najdorf', status: ON_TIME },
        ],
      },
      {
        id: 'c2',
        displayName: 'Ona',
        groups: [],
        assignments: [
          { repertoireId: 'r-London', name: 'London', status: ON_TIME },
        ],
      },
    ]);
  });

  it('gives a coach with nothing assigned an empty list', () => {
    expect(coachRows([coach('c1', 'Ona')], [])).toEqual([
      { id: 'c1', displayName: 'Ona', groups: [], assignments: [] },
    ]);
  });

  it("builds each status from the player's own facts: deadline, overdue, paused, done", () => {
    const [row] = coachRows(
      [coach('c1', 'Ona')],
      [
        assignment('c1', 'Late', {
          deadline: '2026-11-20',
          paused: true,
          badges: { overdue: true, paused: true, updated: true },
        }),
        assignment('c1', 'Through', { deadline: '2026-12-20', done: true }),
      ],
    );
    // A player's assignment is never a fork: no forked flag (#401).
    expect(row?.assignments.map(({ status }) => status)).toStrictEqual([
      { deadline: '2026-11-20', overdue: true, paused: true, done: false },
      { deadline: '2026-12-20', overdue: false, paused: false, done: true },
    ]);
  });

  it("drops an assignment whose coach is no longer among the player's coaches", () => {
    expect(coachRows([], [assignment('gone', 'Orphan')])).toEqual([]);
  });
});

describe('myCoachesData', () => {
  beforeEach(() => {
    server.coaches.mockReset().mockResolvedValue([coach('c1', 'Ona')]);
    server.assignments
      .mockReset()
      .mockResolvedValue([assignment('c1', 'Alapin')]);
  });

  it("reads the session player's coaches and assignments, with the Vilnius day", async () => {
    // 23:30 UTC on 28 Nov is already 29 Nov in Vilnius.
    const now = new Date('2026-11-28T23:30:00Z');
    expect(await myCoachesData('p1', now)).toEqual({
      coaches: [
        {
          id: 'c1',
          displayName: 'Ona',
          groups: [],
          assignments: [
            { repertoireId: 'r-Alapin', name: 'Alapin', status: ON_TIME },
          ],
        },
      ],
      today: '2026-11-29',
    });
    expect(server.coaches).toHaveBeenCalledExactlyOnceWith(DB, 'p1');
    expect(server.assignments).toHaveBeenCalledExactlyOnceWith(DB, 'p1', now);
  });
});
