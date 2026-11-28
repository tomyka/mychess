import type { LinkedAccount } from '@mychess/db';
import type { Account, BadgeSet, RepertoireKind } from '@mychess/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readLinkedQuery } from '../lib/routes';
import type { TodayAssigned, TodayAssignments } from './assignment-pages';
import { pageRows, todayPage } from './today-page';
import type { TodayListRow, TodaySummary } from './training';

const DB = { db: 'today' };

const server = vi.hoisted(() => ({
  assignments: vi.fn<(account: Account) => Promise<TodayAssignments>>(),
  list: vi.fn<(account: Account) => Promise<TodayListRow[]>>(),
  summary: vi.fn<(account: Account) => Promise<TodaySummary>>(),
  coaches: vi.fn<(db: unknown, playerId: string) => Promise<LinkedAccount[]>>(),
}));

// The loaders the page joins read the session and the db.
vi.mock('./assignment-pages', () => ({
  todayAssignments: server.assignments,
}));
vi.mock('./training', () => ({
  todaySummary: server.summary,
  todayList: server.list,
}));
vi.mock('@mychess/db', () => ({ playerCoaches: server.coaches }));
vi.mock('./db', () => ({ getDb: () => DB }));

/** Repertoire `id`'s row on Today's list, named after it. */
const row = (id: string, kind: RepertoireKind): TodayListRow => ({
  repertoireId: id,
  name: `Name ${id}`,
  side: 'black',
  kind,
  due: 0,
  canLearn: false,
  action: null,
  standing: {
    counts: { notStarted: 1, skipped: 0, due: 0, learned: 0 },
    mastered: false,
  },
});

const BADGES: BadgeSet = {
  overdue: false,
  paused: false,
  updated: true,
};

/** The facts a row keeps: coach, deadline and badges. */
const FACTS = { coachName: 'Rimantas', deadline: '2026-12-03', badges: BADGES };

/** Repertoire `repertoireId`'s assignment, as todayAssignments gives it. */
const assigned = (repertoireId: string): TodayAssigned => ({
  repertoireId,
  ...FACTS,
});

describe('pageRows (R-222)', () => {
  it("gives each assignment its facts by repertoire id, in the rows' order", () => {
    expect(
      pageRows(
        [row('a', 'assigned'), row('o', 'own'), row('b', 'assigned')],
        [assigned('b'), assigned('a')],
      ),
    ).toEqual([
      { ...row('a', 'assigned'), assignment: FACTS },
      { ...row('o', 'own'), assignment: null },
      { ...row('b', 'assigned'), assignment: FACTS },
    ]);
  });

  it('never gives an own repertoire assignment facts, even with its id', () => {
    expect(pageRows([row('o', 'own')], [assigned('o')])).toEqual([
      { ...row('o', 'own'), assignment: null },
    ]);
  });

  it('shows an assignment whose facts are gone as a plain row', () => {
    expect(pageRows([row('a', 'assigned')], [])).toEqual([
      { ...row('a', 'assigned'), assignment: null },
    ]);
  });
});

describe('todayPage', () => {
  const NOW = new Date('2026-11-25T08:00:00Z');
  const ROKAS: Account = {
    id: 'rokas',
    email: 'rokas@example.test',
    emailVerified: true,
    displayName: 'Rokas',
    entitlement: 'free',
    admin: false,
    disabledAt: null,
    onboardedAt: NOW,
    coachSince: null,
    createdAt: NOW,
  };
  const SUMMARY: TodaySummary = {
    due: 0,
    toLearn: 1,
    minutes: 0,
    nextDue: null,
  };
  const OFFER = { id: 'f1', name: 'Kita', coachName: 'Rimantas', daysLeft: 3 };

  beforeEach(() => {
    server.coaches.mockReset();
    server.summary.mockResolvedValue(SUMMARY);
    server.list.mockResolvedValue([]);
    server.assignments.mockResolvedValue({ assigned: [], offers: [] });
  });

  it("greets the account and gives the list's rows their assignments' facts", async () => {
    server.list.mockResolvedValue([row('a', 'assigned'), row('o', 'own')]);
    server.assignments.mockResolvedValue({
      assigned: [assigned('a')],
      offers: [OFFER],
    });
    expect(await todayPage(ROKAS, readLinkedQuery({}))).toEqual({
      displayName: 'Rokas',
      summary: SUMMARY,
      rows: [
        { ...row('a', 'assigned'), assignment: FACTS },
        { ...row('o', 'own'), assignment: null },
      ],
      offers: [OFFER],
      linked: null,
    });
    // Every part is the session account's, read once (no second session read).
    expect(server.summary).toHaveBeenCalledExactlyOnceWith(ROKAS);
    expect(server.list).toHaveBeenCalledExactlyOnceWith(ROKAS);
    expect(server.assignments).toHaveBeenCalledExactlyOnceWith(ROKAS);
  });

  describe('the linked notice after accepting an invite (R-234)', () => {
    const RIMANTAS: LinkedAccount = {
      id: 'c1',
      displayName: 'Rimantas',
      linkedAt: NOW,
      groups: [
        { id: 'g0', name: 'Seniors' },
        { id: 'g1', name: 'Juniors 2026' },
      ],
    };
    const ONA: LinkedAccount = {
      id: 'c2',
      displayName: 'Ona',
      linkedAt: NOW,
      groups: [{ id: 'g2', name: 'Ona group' }],
    };

    /** The notice for Today's query, read as the page reads it. */
    const linkedOf = async (params: {
      linked?: string | string[];
      group?: string | string[];
    }): Promise<unknown> =>
      (await todayPage(ROKAS, readLinkedQuery(params))).linked;

    it("names the coach and the group from the session account's own links", async () => {
      server.coaches.mockResolvedValue([ONA, RIMANTAS]);
      expect(await linkedOf({ linked: 'c1', group: 'g1' })).toEqual({
        coachName: 'Rimantas',
        groupName: 'Juniors 2026',
      });
      expect(server.coaches).toHaveBeenCalledExactlyOnceWith(DB, 'rokas');
    });

    it('names no group the player is not in with that coach', async () => {
      server.coaches.mockResolvedValue([ONA, RIMANTAS]);
      expect(await linkedOf({ linked: 'c1', group: 'g2' })).toEqual({
        coachName: 'Rimantas',
        groupName: null,
      });
      expect(await linkedOf({ linked: 'c1' })).toEqual({
        coachName: 'Rimantas',
        groupName: null,
      });
    });

    it("names no group the player left, or one the address repeats: only the player's own memberships, from one param", async () => {
      // playerCoaches lists only the groups the player is in now, so a
      // group of that coach the player left is not among them.
      server.coaches.mockResolvedValue([RIMANTAS]);
      expect(await linkedOf({ linked: 'c1', group: 'g-left' })).toEqual({
        coachName: 'Rimantas',
        groupName: null,
      });
      expect(await linkedOf({ linked: 'c1', group: ['g1', 'g1'] })).toEqual({
        coachName: 'Rimantas',
        groupName: null,
      });
    });

    it('names no one the player is not linked with', async () => {
      server.coaches.mockResolvedValue([ONA]);
      expect(await linkedOf({ linked: 'c1', group: 'g1' })).toBeNull();
    });

    it('reads no coaches without a single `linked` param', async () => {
      expect(await linkedOf({})).toBeNull();
      expect(await linkedOf({ linked: ['c1', 'c2'] })).toBeNull();
      expect(await linkedOf({ group: 'g1' })).toBeNull();
      expect(server.coaches).not.toHaveBeenCalled();
    });
  });
});
