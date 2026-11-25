import type { Account, BadgeSet } from '@mychess/domain';
import { describe, expect, it, vi } from 'vitest';
import type { AssignedListItem, HomeAssignments } from './assignment-pages';
import { joinFacts, todayPage } from './today-page';
import type { TodaySummary, TodaySummaryRow } from './training';

const server = vi.hoisted(() => ({
  assignments: vi.fn<() => Promise<HomeAssignments>>(),
  summary: vi.fn<(account: Account) => Promise<TodaySummary>>(),
}));

// The loaders the page joins read the session and the db.
vi.mock('./assignment-pages', () => ({
  homeAssignments: server.assignments,
}));
vi.mock('./training', () => ({ todaySummary: server.summary }));

const row = (id: string, kind: 'own' | 'assigned'): TodaySummaryRow => ({
  id,
  name: id,
  side: 'white',
  kind,
  due: 0,
  canLearn: false,
  counts: { notStarted: 1, skipped: 0, due: 0, learned: 0 },
  mastered: false,
});

const BADGES: BadgeSet = {
  overdue: false,
  paused: false,
  forked: false,
  updated: true,
};

const facts = (repertoireId: string): AssignedListItem => ({
  repertoireId,
  name: repertoireId,
  side: 'white',
  coachName: 'Rimantas',
  deadline: null,
  badges: BADGES,
});

describe('joinFacts (R-222)', () => {
  it('attaches an assignment its facts by repertoire id', () => {
    expect(
      joinFacts(
        [row('a', 'assigned'), row('o', 'own'), row('b', 'assigned')],
        [facts('b'), facts('a')],
      ),
    ).toEqual([
      { ...row('a', 'assigned'), assignment: facts('a') },
      { ...row('o', 'own'), assignment: null },
      { ...row('b', 'assigned'), assignment: facts('b') },
    ]);
  });

  it('never gives an own repertoire assignment facts, even with its id', () => {
    expect(joinFacts([row('o', 'own')], [facts('o')])).toEqual([
      { ...row('o', 'own'), assignment: null },
    ]);
  });

  it('shows an assignment whose facts are gone as a plain row', () => {
    expect(joinFacts([row('a', 'assigned')], [])).toEqual([
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
    rows: [row('a', 'assigned'), row('o', 'own')],
  };
  const OFFER = { id: 'f1', name: 'Kita', coachName: 'Rimantas', daysLeft: 3 };

  it("greets the account and joins the summary's rows to the assignments", async () => {
    server.summary.mockResolvedValue(SUMMARY);
    server.assignments.mockResolvedValue({
      fromCoach: [facts('a')],
      offers: [OFFER],
    });
    expect(await todayPage(ROKAS)).toEqual({
      displayName: 'Rokas',
      summary: SUMMARY,
      rows: [
        { ...row('a', 'assigned'), assignment: facts('a') },
        { ...row('o', 'own'), assignment: null },
      ],
      offers: [OFFER],
    });
    // The summary is the session account's.
    expect(server.summary).toHaveBeenCalledExactlyOnceWith(ROKAS);
  });
});
