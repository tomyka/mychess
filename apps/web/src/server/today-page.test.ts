import type { Account, BadgeSet, RepertoireKind } from '@mychess/domain';
import { describe, expect, it, vi } from 'vitest';
import type { TodayAssigned, TodayAssignments } from './assignment-pages';
import { pageRows, todayPage } from './today-page';
import type { TodayListRow, TodaySummary } from './training';

const server = vi.hoisted(() => ({
  assignments: vi.fn<(account: Account) => Promise<TodayAssignments>>(),
  list: vi.fn<(account: Account) => Promise<TodayListRow[]>>(),
  summary: vi.fn<(account: Account) => Promise<TodaySummary>>(),
}));

// The loaders the page joins read the session and the db.
vi.mock('./assignment-pages', () => ({
  todayAssignments: server.assignments,
}));
vi.mock('./training', () => ({
  todaySummary: server.summary,
  todayList: server.list,
}));

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
  forked: false,
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

  it("greets the account and gives the list's rows their assignments' facts", async () => {
    server.summary.mockResolvedValue(SUMMARY);
    server.list.mockResolvedValue([row('a', 'assigned'), row('o', 'own')]);
    server.assignments.mockResolvedValue({
      assigned: [assigned('a')],
      offers: [OFFER],
    });
    expect(await todayPage(ROKAS)).toEqual({
      displayName: 'Rokas',
      summary: SUMMARY,
      rows: [
        { ...row('a', 'assigned'), assignment: FACTS },
        { ...row('o', 'own'), assignment: null },
      ],
      offers: [OFFER],
    });
    // Every part is the session account's, read once (no second session read).
    expect(server.summary).toHaveBeenCalledExactlyOnceWith(ROKAS);
    expect(server.list).toHaveBeenCalledExactlyOnceWith(ROKAS);
    expect(server.assignments).toHaveBeenCalledExactlyOnceWith(ROKAS);
  });
});
