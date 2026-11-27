import { describe, expect, it } from 'vitest';
import type { AssignmentFacts, AssignmentReach } from './assignment';
import { assigneeCount, livePlayerCount } from './assignees';

const AT = new Date('2026-10-20T09:00:00Z');

const reach = (assignmentId: string): AssignmentReach => ({
  assignmentId,
  deadline: null,
  assignedVersion: 1,
  joinedAt: null,
});

/** The facts of `playerId` on repertoire r1, reached by `reaches`. */
const facts = (
  playerId: string,
  over: Partial<AssignmentFacts> = {},
): AssignmentFacts => ({
  playerId,
  repertoireId: 'r1',
  coachId: 'c',
  reaches: [reach('a-1')],
  pausedAt: null,
  seenVersion: null,
  forkedAt: null,
  ...over,
});

describe('assigneeCount (R-225, R-230)', () => {
  it('is 0 when the repertoire reaches no one', () => {
    expect(assigneeCount([])).toBe(0);
  });

  it('counts each reached player once, however many rows reach them', () => {
    expect(
      assigneeCount([{ playerId: 'p' }, { playerId: 'q' }, { playerId: 'p' }]),
    ).toBe(2);
  });

  it('counts a player who forked or paused it: they were assigned it', () => {
    expect(
      assigneeCount([
        facts('p', { forkedAt: AT }),
        facts('q', { pausedAt: AT }),
        facts('n'),
      ]),
    ).toBe(3);
  });
});

describe('livePlayerCount (R-131)', () => {
  it('is 0 when the repertoire reaches no one', () => {
    expect(livePlayerCount([])).toBe(0);
  });

  it('counts the players who have it live, a paused one included', () => {
    expect(livePlayerCount([facts('p'), facts('q', { pausedAt: AT })])).toBe(2);
  });

  it('leaves out a player who forked it: they get no fork offer when it is deleted', () => {
    expect(livePlayerCount([facts('p'), facts('q', { forkedAt: AT })])).toBe(1);
  });

  it('leaves out facts no row reaches any more', () => {
    expect(livePlayerCount([facts('p', { reaches: [] }), facts('q')])).toBe(1);
  });

  it('counts a player once across several records of them', () => {
    expect(
      livePlayerCount([facts('p'), facts('p', { repertoireId: 'r2' })]),
    ).toBe(1);
  });
});
