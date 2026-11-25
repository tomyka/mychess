import type { TodayRow } from '@mychess/chess';
import type { Account, BadgeSet, RepertoireKind } from '@mychess/domain';
import { describe, expect, it, vi } from 'vitest';
import type { AssignedListItem, TodayAssignments } from './assignment-pages';
import { pageRows, todayPage } from './today-page';
import type { TodayEntry, TodaySummary, TodayTraining } from './training';

const server = vi.hoisted(() => ({
  assignments: vi.fn<(account: Account) => Promise<TodayAssignments>>(),
  training: vi.fn<(account: Account) => Promise<TodayTraining>>(),
  summary: vi.fn<(account: Account) => Promise<TodaySummary>>(),
}));

// The loaders the page joins read the session and the db.
vi.mock('./assignment-pages', () => ({
  todayAssignments: server.assignments,
}));
vi.mock('./training', () => ({
  todaySummary: server.summary,
  todayTraining: server.training,
}));

/** Repertoire `id`'s row as todayRows gives it. */
const row = (id: string): TodayRow => ({
  repertoireId: id,
  due: 0,
  canLearn: false,
  action: null,
  standing: {
    counts: { notStarted: 1, skipped: 0, due: 0, learned: 0 },
    mastered: false,
  },
});

/** Repertoire `id`'s entry, named after it. */
const entry = (id: string, kind: RepertoireKind): TodayEntry => ({
  id,
  name: `Name ${id}`,
  side: 'black',
  kind,
});

const BADGES: BadgeSet = {
  overdue: false,
  paused: false,
  forked: false,
  updated: true,
};

/** An assignment's list item: its own name and side, which the row ignores. */
const facts = (repertoireId: string): AssignedListItem => ({
  repertoireId,
  name: 'Not the row name',
  side: 'white',
  coachName: 'Rimantas',
  deadline: '2026-12-03',
  badges: BADGES,
});

/** The facts a row keeps: coach, deadline and badges only. */
const KEPT = { coachName: 'Rimantas', deadline: '2026-12-03', badges: BADGES };

/** The finished row of `id`, with its entry and `assignment`. */
const finished = (
  id: string,
  kind: RepertoireKind,
  assignment: typeof KEPT | null,
) => ({
  ...row(id),
  name: `Name ${id}`,
  side: 'black',
  kind,
  assignment,
});

describe('pageRows (R-221, R-222)', () => {
  it("names each row by its entry and gives an assignment its facts, in the rows' order", () => {
    expect(
      pageRows(
        {
          rows: [row('a'), row('o'), row('b')],
          entries: [
            entry('o', 'own'),
            entry('b', 'assigned'),
            entry('a', 'assigned'),
          ],
        },
        [facts('b'), facts('a')],
      ),
    ).toEqual([
      finished('a', 'assigned', KEPT),
      finished('o', 'own', null),
      finished('b', 'assigned', KEPT),
    ]);
  });

  it('never gives an own repertoire assignment facts, even with its id', () => {
    expect(
      pageRows({ rows: [row('o')], entries: [entry('o', 'own')] }, [
        facts('o'),
      ]),
    ).toEqual([finished('o', 'own', null)]);
  });

  it('shows an assignment whose facts are gone as a plain row', () => {
    expect(
      pageRows({ rows: [row('a')], entries: [entry('a', 'assigned')] }, []),
    ).toEqual([finished('a', 'assigned', null)]);
  });

  it('leaves out a row with no entry', () => {
    expect(
      pageRows({ rows: [row('x'), row('o')], entries: [entry('o', 'own')] }, [
        facts('x'),
      ]),
    ).toEqual([finished('o', 'own', null)]);
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

  it('greets the account and builds the rows from the training and the assignments', async () => {
    server.summary.mockResolvedValue(SUMMARY);
    server.training.mockResolvedValue({
      rows: [row('a'), row('o')],
      entries: [entry('o', 'own'), entry('a', 'assigned')],
    });
    server.assignments.mockResolvedValue({
      assigned: [facts('a')],
      offers: [OFFER],
    });
    expect(await todayPage(ROKAS)).toEqual({
      displayName: 'Rokas',
      summary: SUMMARY,
      rows: [finished('a', 'assigned', KEPT), finished('o', 'own', null)],
      offers: [OFFER],
    });
    // Every part is the session account's, read once (no second session read).
    expect(server.summary).toHaveBeenCalledExactlyOnceWith(ROKAS);
    expect(server.training).toHaveBeenCalledExactlyOnceWith(ROKAS);
    expect(server.assignments).toHaveBeenCalledExactlyOnceWith(ROKAS);
  });
});
