import { describe, expect, it } from 'vitest';
import {
  ASSIGNMENT_ISSUES,
  ASSIGNMENT_REFUSALS,
  assignmentStatus,
  canAssign,
  canFork,
  canUseAssignment,
  deadlineSchema,
  effectiveDeadline,
  isTrainingActive,
  isUpdated,
  seenFloor,
  type AssignFacts,
  type AssignmentTarget,
} from './assignment';

const ok = { ok: true, value: undefined };
const refused = (reason: string) => ({ ok: false, refusal: { reason } });

const facts = (over: Partial<AssignFacts> = {}): AssignFacts => ({
  coachSince: new Date('2026-10-01T00:00:00Z'),
  repertoireOwnerId: 'coach',
  targetAllowed: true,
  alreadyAssigned: false,
  ...over,
});
const player: AssignmentTarget = { kind: 'player', playerId: 'p1' };
const group: AssignmentTarget = { kind: 'group', groupId: 'g1' };

describe('ASSIGNMENT_REFUSALS', () => {
  it('are message-catalogue keys', () => {
    expect(ASSIGNMENT_REFUSALS).toStrictEqual({
      notCoach: 'assignment.notCoach',
      notFound: 'assignment.notFound',
      notLinked: 'assignment.notLinked',
      groupNotFound: 'assignment.groupNotFound',
      alreadyAssigned: 'assignment.alreadyAssigned',
    });
  });
});

describe('ASSIGNMENT_ISSUES', () => {
  it('are message-catalogue keys', () => {
    expect(ASSIGNMENT_ISSUES).toStrictEqual({
      deadlineInvalid: 'assignment.deadlineInvalid',
    });
  });
});

describe('canAssign (R-15, R-16; plan decision 1)', () => {
  it.each<[string, AssignmentTarget, AssignFacts, unknown]>([
    [
      'allows the coach’s own repertoire to a linked player',
      player,
      facts(),
      ok,
    ],
    ['allows it to the coach’s own group', group, facts(), ok],
    [
      'refuses with Coach mode off',
      player,
      facts({ coachSince: null }),
      refused('assignment.notCoach'),
    ],
    [
      'refuses with Coach mode off before anything else',
      player,
      facts({
        coachSince: null,
        repertoireOwnerId: 'other',
        targetAllowed: false,
        alreadyAssigned: true,
      }),
      refused('assignment.notCoach'),
    ],
    [
      'refuses someone else’s repertoire',
      player,
      facts({ repertoireOwnerId: 'other' }),
      refused('assignment.notFound'),
    ],
    [
      'refuses someone else’s repertoire before checking the target',
      group,
      facts({ repertoireOwnerId: 'other', targetAllowed: false }),
      refused('assignment.notFound'),
    ],
    [
      'refuses a missing repertoire',
      player,
      facts({ repertoireOwnerId: undefined }),
      refused('assignment.notFound'),
    ],
    [
      'refuses an unlinked player',
      player,
      facts({ targetAllowed: false }),
      refused('assignment.notLinked'),
    ],
    [
      'refuses an unlinked player before a duplicate',
      player,
      facts({ targetAllowed: false, alreadyAssigned: true }),
      refused('assignment.notLinked'),
    ],
    [
      'refuses another coach’s group',
      group,
      facts({ targetAllowed: false }),
      refused('assignment.groupNotFound'),
    ],
    [
      'refuses a second assignment to the same group',
      group,
      facts({ alreadyAssigned: true }),
      refused('assignment.alreadyAssigned'),
    ],
    [
      'refuses a second assignment to the same player',
      player,
      facts({ alreadyAssigned: true }),
      refused('assignment.alreadyAssigned'),
    ],
  ])('%s', (_, target, f, expected) => {
    expect(canAssign('coach', target, f)).toStrictEqual(expected);
  });

  it('refuses assigning to oneself even if a link were claimed', () => {
    expect(
      canAssign('coach', { kind: 'player', playerId: 'coach' }, facts()),
    ).toStrictEqual(refused('assignment.notLinked'));
  });

  it('allows a group whose id happens to equal the coach id', () => {
    expect(
      canAssign('coach', { kind: 'group', groupId: 'coach' }, facts()),
    ).toStrictEqual(ok);
  });
});

describe('deadlineSchema (plan decision 10)', () => {
  it('accepts a calendar date', () => {
    expect(deadlineSchema.parse('2026-11-30')).toBe('2026-11-30');
  });

  it.each(['30.11.2026', '2026-13-01', '2026-11-30T00:00:00Z', ''])(
    'refuses %j with a catalogue key',
    (input) => {
      const bad = deadlineSchema.safeParse(input);
      expect(
        bad.success ? null : bad.error.issues.map((i) => i.message),
      ).toStrictEqual(['assignment.deadlineInvalid']);
    },
  );

  it('refuses a non-string with the same key', () => {
    const bad = deadlineSchema.safeParse(20261130);
    expect(
      bad.success ? null : bad.error.issues.map((i) => i.message),
    ).toStrictEqual(['assignment.deadlineInvalid']);
  });
});

describe('effectiveDeadline', () => {
  const g = (deadline: string | null, joinedDay = '2026-10-01') => ({
    deadline,
    joinedDay,
  });

  it('takes the individual deadline over any group one (R-134)', () => {
    expect(
      effectiveDeadline({
        individual: { deadline: '2026-12-01' },
        groups: [g('2026-11-01')],
      }),
    ).toBe('2026-12-01');
  });

  it('takes an individual "no deadline" over a group deadline (R-134)', () => {
    expect(
      effectiveDeadline({
        individual: { deadline: null },
        groups: [g('2026-11-01')],
      }),
    ).toBeNull();
  });

  it('does not move an individual deadline to a group join day', () => {
    expect(
      effectiveDeadline({
        individual: { deadline: '2026-11-01' },
        groups: [g('2026-11-01', '2026-11-20')],
      }),
    ).toBe('2026-11-01');
  });

  it('moves a group deadline to a later join day (R-16)', () => {
    expect(effectiveDeadline({ groups: [g('2026-11-01', '2026-11-20')] })).toBe(
      '2026-11-20',
    );
  });

  it('keeps a group deadline after the join day', () => {
    expect(effectiveDeadline({ groups: [g('2026-11-01', '2026-10-20')] })).toBe(
      '2026-11-01',
    );
  });

  it('takes the earliest of several groups’ deadlines, ignoring groups without one', () => {
    expect(
      effectiveDeadline({
        groups: [g(null), g('2026-12-01'), g('2026-11-15'), g('2026-11-20')],
      }),
    ).toBe('2026-11-15');
  });

  it('compares the deadlines after moving them to the join days', () => {
    expect(
      effectiveDeadline({
        groups: [g('2026-11-01', '2026-11-25'), g('2026-11-10', '2026-10-01')],
      }),
    ).toBe('2026-11-10');
  });

  it('is null with no deadline anywhere', () => {
    expect(effectiveDeadline({ groups: [g(null)] })).toBeNull();
    expect(effectiveDeadline({ groups: [] })).toBeNull();
  });
});

describe('assignmentStatus', () => {
  const now = new Date('2026-11-02T10:00:00Z'); // 2 Nov in Vilnius
  const base = {
    deadline: '2026-11-01',
    done: false,
    paused: false,
    forked: false,
  };

  it('is overdue from the day after the deadline (R-51)', () => {
    expect(assignmentStatus(base, now)).toStrictEqual({
      overdue: true,
      paused: false,
      done: false,
      forked: false,
    });
    expect(
      assignmentStatus({ ...base, deadline: '2026-11-02' }, now).overdue,
    ).toBe(false);
    expect(
      assignmentStatus({ ...base, deadline: '2026-11-03' }, now).overdue,
    ).toBe(false);
  });

  it('counts the day in Vilnius, not UTC', () => {
    const lateEvening = new Date('2026-11-01T22:30:00Z'); // 2 Nov 00:30 in Vilnius
    expect(assignmentStatus(base, lateEvening).overdue).toBe(true);
  });

  it('is never overdue when done (R-129)', () => {
    expect(assignmentStatus({ ...base, done: true }, now)).toStrictEqual({
      overdue: false,
      paused: false,
      done: true,
      forked: false,
    });
  });

  it('is overdue and paused at once (R-132)', () => {
    expect(assignmentStatus({ ...base, paused: true }, now)).toStrictEqual({
      overdue: true,
      paused: true,
      done: false,
      forked: false,
    });
  });

  it('is never overdue without a deadline', () => {
    expect(assignmentStatus({ ...base, deadline: null }, now)).toStrictEqual({
      overdue: false,
      paused: false,
      done: false,
      forked: false,
    });
  });

  it('shows only "forked" once the player forked (R-128)', () => {
    expect(
      assignmentStatus(
        { ...base, paused: true, done: true, forked: true },
        now,
      ),
    ).toStrictEqual({
      overdue: false,
      paused: false,
      done: false,
      forked: true,
    });
  });
});

describe('canUseAssignment and canFork (R-46, R-128)', () => {
  it.each([
    [{ assigned: true, forked: false }, ok],
    [{ assigned: false, forked: false }, refused('assignment.notFound')],
    [{ assigned: true, forked: true }, refused('assignment.notFound')],
    [{ assigned: false, forked: true }, refused('assignment.notFound')],
  ])('decides %j', (hold, expected) => {
    expect(canUseAssignment(hold)).toStrictEqual(expected);
    expect(canFork(hold)).toStrictEqual(expected);
  });
});

describe('seenFloor and isUpdated (R-133)', () => {
  it.each([
    ['the assigned version when never seen', null, 3, 3],
    ['the seen version when later', 5, 3, 5],
    ['the assigned version over an older seen one', 2, 3, 3],
  ] as const)('starts from %s', (_, seenVersion, assignedVersion, floor) => {
    expect(seenFloor({ seenVersion, assignedVersion })).toBe(floor);
  });

  it.each([
    [
      'a change after the floor',
      { seenVersion: 2, assignedVersion: 1 },
      3,
      true,
    ],
    ['no change after it', { seenVersion: 3, assignedVersion: 1 }, 3, false],
    ['no change at all', { seenVersion: null, assignedVersion: 1 }, 0, false],
    [
      'only changes before the assignment, even if seen earlier',
      { seenVersion: 1, assignedVersion: 4 },
      3,
      false,
    ],
  ] as const)('is updated for %s', (_, facts, latest, updated) => {
    expect(isUpdated(facts, latest)).toBe(updated);
  });
});

describe('isTrainingActive (R-46)', () => {
  it('is active unless paused', () => {
    expect(isTrainingActive(null)).toBe(true);
    expect(isTrainingActive(new Date('2026-10-20T09:00:00Z'))).toBe(false);
  });
});
