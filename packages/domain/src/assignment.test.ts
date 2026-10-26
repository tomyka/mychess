import { describe, expect, it } from 'vitest';
import {
  ASSIGNMENT_ISSUES,
  ASSIGNMENT_REFUSALS,
  assignableTargets,
  assignmentBadges,
  assignmentStatus,
  assignmentStatusOf,
  canAssign,
  canChangeAssignment,
  canFork,
  canUseAssignment,
  coachAssignmentBadges,
  deadlineSchema,
  deadlineSources,
  effectiveDeadline,
  isTrainingActive,
  isUpdated,
  newsOf,
  type AssignFacts,
  type AssignmentFacts,
  type AssignmentReach,
  type AssignmentStart,
  type ChangeStamp,
  type SeenFacts,
  type AssignmentTarget,
  type BadgeSet,
} from './assignment';
import { vilniusDay } from './calendar';

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

  it('never reads a group as oneself, whatever else the target carries', () => {
    const groupRow = {
      kind: 'group',
      groupId: 'g1',
      playerId: 'coach',
    } as const;
    expect(canAssign('coach', groupRow, facts())).toStrictEqual(ok);
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

  it.each([
    ['0000-01-01', false],
    ['1999-12-31', false],
    ['2000-01-01', true],
    ['9999-12-31', true],
  ])('limits %s to the years 2000-9999 (accepted: %s)', (input, accepted) => {
    const result = deadlineSchema.safeParse(input);
    expect(
      result.success ? result.data : result.error.issues.map((i) => i.message),
    ).toStrictEqual(accepted ? input : ['assignment.deadlineInvalid']);
  });

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
  const FORKED_AT = new Date('2026-10-20T09:00:00Z');
  const held = (over: Partial<AssignmentFacts> = {}): AssignmentFacts => ({
    playerId: 'p',
    repertoireId: 'r',
    coachId: 'c',
    reaches: [
      { assignmentId: 'a', deadline: null, assignedVersion: 1, joinedAt: null },
    ],
    pausedAt: null,
    seenVersion: null,
    forkedAt: null,
    ...over,
  });

  it.each([
    ['assigned, not forked', held(), ok],
    ['no record', undefined, refused('assignment.notFound')],
    ['not assigned', held({ reaches: [] }), refused('assignment.notFound')],
    [
      'assigned and forked',
      held({ forkedAt: FORKED_AT }),
      refused('assignment.notFound'),
    ],
    [
      'not assigned and forked',
      held({ reaches: [], forkedAt: FORKED_AT }),
      refused('assignment.notFound'),
    ],
  ])('decides %s', (_, facts, expected) => {
    expect(canUseAssignment(facts)).toStrictEqual(expected);
    expect(canFork(facts)).toStrictEqual(expected);
  });
});

describe('newsOf and isUpdated (R-133, R-136)', () => {
  const joined = new Date('2026-10-10T12:00:00Z');
  const before = new Date('2026-10-09T12:00:00Z');
  const after = new Date('2026-10-11T12:00:00Z');
  const change = (version: number, createdAt: Date): ChangeStamp => ({
    version,
    createdAt,
  });
  const individually = (assignedVersion: number): AssignmentStart => ({
    assignedVersion,
    joinedAt: null,
  });
  const viaGroup = (
    assignedVersion: number,
    joinedAt: Date,
  ): AssignmentStart => ({ assignedVersion, joinedAt });
  const seen = (
    seenVersion: number | null,
    ...starts: AssignmentStart[]
  ): SeenFacts => ({ seenVersion, starts });

  it.each([
    [
      'a change after the assignment, never seen',
      seen(null, individually(1)),
      change(2, before),
      true,
    ],
    [
      'a change at the assigned version',
      seen(null, individually(2)),
      change(2, after),
      false,
    ],
    [
      'a change after the seen version',
      seen(2, individually(1)),
      change(3, before),
      true,
    ],
    [
      'a change at the seen version',
      seen(3, individually(1)),
      change(3, after),
      false,
    ],
    [
      'a change before the assignment, even if seen earlier',
      seen(1, individually(4)),
      change(3, after),
      false,
    ],
    [
      'a group change after the player joined',
      seen(null, viaGroup(1, joined)),
      change(2, after),
      true,
    ],
    [
      'a group change before the player joined (R-136)',
      seen(null, viaGroup(1, joined)),
      change(2, before),
      false,
    ],
    [
      'a group change at the moment the player joined',
      seen(null, viaGroup(1, joined)),
      change(2, joined),
      false,
    ],
    [
      'a group change after joining but not after the group was assigned',
      seen(null, viaGroup(3, joined)),
      change(3, after),
      false,
    ],
    [
      'a change before joining when also assigned individually',
      seen(null, viaGroup(1, joined), individually(1)),
      change(2, before),
      true,
    ],
    [
      'a change counted by a second group joined earlier',
      seen(null, viaGroup(1, after), viaGroup(1, before)),
      change(2, joined),
      true,
    ],
    [
      'a change neither group counts: one joined later, one assigned later',
      seen(null, viaGroup(1, after), viaGroup(3, before)),
      change(2, joined),
      false,
    ],
    [
      'a change already seen though made after joining',
      seen(4, viaGroup(1, joined)),
      change(4, after),
      false,
    ],
    [
      'a change after an individual assignment, whatever its time',
      seen(null, individually(1)),
      change(2, new Date(0)),
      true,
    ],
    ['a change with no start at all', seen(null), change(2, after), false],
  ] as const)('decides %s', (_, facts, stamp, news) => {
    expect(newsOf(facts, [stamp])).toStrictEqual(news ? [stamp] : []);
    expect(isUpdated(facts, stamp)).toBe(news);
  });

  it('keeps the rows that are news, in their order', () => {
    const rows = [
      { ...change(2, before), tag: 'a' },
      { ...change(3, after), tag: 'b' },
      { ...change(4, after), tag: 'c' },
    ];
    expect(newsOf(seen(3, viaGroup(1, joined)), rows)).toStrictEqual([rows[2]]);
    expect(newsOf(seen(null, viaGroup(1, joined)), rows)).toStrictEqual([
      rows[1],
      rows[2],
    ]);
  });

  it('is not updated without any change', () => {
    expect(isUpdated(seen(null, individually(1)), undefined)).toBe(false);
  });
});

describe('isTrainingActive (R-46)', () => {
  it('is active unless paused', () => {
    expect(isTrainingActive(null)).toBe(true);
    expect(isTrainingActive(new Date('2026-10-20T09:00:00Z'))).toBe(false);
  });
});

describe('canChangeAssignment (R-51, R-113)', () => {
  const since = new Date('2026-10-01T00:00:00Z');
  it.each([
    ['allows the coach’s own assignment', since, true, ok],
    ['refuses with Coach mode off', null, true, refused('assignment.notCoach')],
    [
      'refuses with Coach mode off before looking for the assignment',
      null,
      false,
      refused('assignment.notCoach'),
    ],
    [
      'reads someone else’s or a missing assignment as not found',
      since,
      false,
      refused('assignment.notFound'),
    ],
  ] as const)('%s', (_, coachSince, found, expected) => {
    expect(canChangeAssignment({ coachSince, found })).toStrictEqual(expected);
  });
});

describe('assignableTargets (R-15, R-16, R-134)', () => {
  const ann = { id: 'ann', displayName: 'Ann' };
  const bob = { id: 'bob', displayName: 'Bob' };
  const red = { id: 'red', name: 'Red' };
  const blue = { id: 'blue', name: 'Blue' };
  const players = [ann, bob];
  const groups = [red, blue];

  it.each([
    ['offers everyone when it is assigned to no one', [], players, groups],
    [
      'leaves out a player it is assigned to',
      [{ kind: 'player', id: 'ann' }],
      [bob],
      groups,
    ],
    [
      'leaves out a group it is assigned to',
      [{ kind: 'group', id: 'blue' }],
      players,
      [red],
    ],
    [
      'does not mistake a group for a player with the same id',
      [{ kind: 'group', id: 'ann' }],
      players,
      groups,
    ],
    [
      'does not mistake a player for a group with the same id',
      [{ kind: 'player', id: 'red' }],
      players,
      groups,
    ],
    [
      'offers no one once everyone has it',
      [
        { kind: 'player', id: 'ann' },
        { kind: 'player', id: 'bob' },
        { kind: 'group', id: 'red' },
        { kind: 'group', id: 'blue' },
      ],
      [],
      [],
    ],
  ] as const)('%s', (_, assigned, expectedPlayers, expectedGroups) => {
    expect(assignableTargets(players, groups, assigned)).toStrictEqual({
      players: expectedPlayers,
      groups: expectedGroups,
    });
  });

  it('keeps a player who has it only through a group assignable individually (R-134)', () => {
    // Ann is in Red, which has it; only an assignment to Ann takes her out.
    expect(
      assignableTargets([ann], [red], [{ kind: 'group', id: 'red' }]),
    ).toStrictEqual({ players: [ann], groups: [] });
  });

  it('keeps the candidates in their order, as the same objects', () => {
    const { players: left } = assignableTargets([bob, ann], [], []);
    expect(left).toStrictEqual([bob, ann]);
    expect(left[0]).toBe(bob);
  });
});

describe('deadlineSources (R-16, R-134)', () => {
  const joinedAt = new Date('2026-10-10T12:00:00Z');
  const reach = (over: Partial<AssignmentReach> = {}): AssignmentReach => ({
    assignmentId: 'a-1',
    deadline: '2026-11-01',
    assignedVersion: 1,
    joinedAt: null,
    ...over,
  });

  it('takes the individual row and each group row with its join day', () => {
    expect(
      deadlineSources([
        reach({ deadline: '2026-11-01' }),
        reach({ assignmentId: 'a-2', deadline: '2026-10-30', joinedAt }),
      ]),
    ).toStrictEqual({
      individual: { deadline: '2026-11-01' },
      groups: [{ deadline: '2026-10-30', joinedDay: vilniusDay(joinedAt) }],
    });
  });

  it('counts the join day in Vilnius, not UTC', () => {
    expect(
      deadlineSources([reach({ joinedAt: new Date('2026-10-15T22:30:00Z') })])
        .groups,
    ).toStrictEqual([{ deadline: '2026-11-01', joinedDay: '2026-10-16' }]);
  });

  it('has no individual source with group rows only', () => {
    const sources = deadlineSources([
      reach({ deadline: null, joinedAt }),
      reach({ assignmentId: 'a-2', joinedAt }),
    ]);
    expect(sources).not.toHaveProperty('individual');
    expect(sources.groups).toStrictEqual([
      { deadline: null, joinedDay: '2026-10-10' },
      { deadline: '2026-11-01', joinedDay: '2026-10-10' },
    ]);
  });

  it('keeps an individual row without a deadline', () => {
    expect(deadlineSources([reach({ deadline: null })])).toStrictEqual({
      individual: { deadline: null },
      groups: [],
    });
  });

  it('is empty without reaches', () => {
    expect(deadlineSources([])).toStrictEqual({ groups: [] });
  });
});

describe('assignmentStatusOf (R-16, R-129, R-132, R-134, R-128)', () => {
  const now = new Date('2026-11-02T10:00:00Z'); // 2 Nov in Vilnius
  const individual = (deadline: string | null): AssignmentReach => ({
    assignmentId: 'a-1',
    deadline,
    assignedVersion: 1,
    joinedAt: null,
  });
  const viaGroup = (
    deadline: string | null,
    joinedAt: Date,
  ): AssignmentReach => ({
    assignmentId: 'a-2',
    deadline,
    assignedVersion: 1,
    joinedAt,
  });
  const record = (over: Partial<AssignmentFacts> = {}): AssignmentFacts => ({
    playerId: 'p',
    repertoireId: 'r',
    coachId: 'c',
    reaches: [individual('2026-11-01')],
    pausedAt: null,
    seenVersion: null,
    forkedAt: null,
    ...over,
  });
  const PAUSED = new Date('2026-10-20T10:00:00Z');

  const cases: readonly [
    string,
    AssignmentFacts,
    boolean,
    ReturnType<typeof assignmentStatusOf>,
  ][] = [
    [
      'an individual deadline passed and not done is overdue',
      record(),
      false,
      {
        deadline: '2026-11-01',
        overdue: true,
        paused: false,
        done: false,
        forked: false,
      },
    ],
    [
      'done is never overdue (R-129)',
      record(),
      true,
      {
        deadline: '2026-11-01',
        overdue: false,
        paused: false,
        done: true,
        forked: false,
      },
    ],
    [
      'paused and passed is overdue and paused (R-132)',
      record({ pausedAt: PAUSED }),
      false,
      {
        deadline: '2026-11-01',
        overdue: true,
        paused: true,
        done: false,
        forked: false,
      },
    ],
    [
      'forked shows only forked, with the deadline still given (R-128)',
      record({ pausedAt: PAUSED, forkedAt: PAUSED }),
      true,
      {
        deadline: '2026-11-01',
        overdue: false,
        paused: false,
        done: false,
        forked: true,
      },
    ],
    [
      'a group deadline before the join day moves to the join day (R-16)',
      record({
        reaches: [viaGroup('2026-10-20', new Date('2026-11-03T08:00:00Z'))],
      }),
      false,
      {
        deadline: '2026-11-03',
        overdue: false,
        paused: false,
        done: false,
        forked: false,
      },
    ],
    [
      'an individual deadline of null wins over a group deadline (R-134)',
      record({
        reaches: [
          individual(null),
          viaGroup('2026-10-20', new Date('2026-10-01T08:00:00Z')),
        ],
      }),
      false,
      {
        deadline: null,
        overdue: false,
        paused: false,
        done: false,
        forked: false,
      },
    ],
  ];

  it.each(cases)('%s', (_name, facts, done, expected) => {
    expect(assignmentStatusOf(facts, { done, now })).toStrictEqual(expected);
  });

  it.each(cases)(
    'agrees with effectiveDeadline and assignmentStatus: %s',
    (_name, facts, done) => {
      const deadline = effectiveDeadline(deadlineSources(facts.reaches));
      expect(assignmentStatusOf(facts, { done, now })).toStrictEqual({
        deadline,
        ...assignmentStatus(
          {
            deadline,
            done,
            paused: !isTrainingActive(facts.pausedAt),
            forked: facts.forkedAt !== null,
          },
          now,
        ),
      });
    },
  );
});

describe('assignmentBadges (R-46, R-51, R-128, R-133)', () => {
  const bits = [false, true] as const;
  const combos = bits.flatMap((a) =>
    bits.flatMap((b) => bits.map((c) => [a, b, c] as const)),
  );

  it.each(combos)(
    'the player sees overdue, paused and updated, never forked: %s %s %s',
    (overdue, paused, updated) => {
      expect(
        assignmentBadges({ audience: 'player', overdue, paused, updated }),
      ).toStrictEqual({ overdue, paused, forked: false, updated });
    },
  );

  it.each(bits.flatMap((a) => bits.map((b) => [a, b] as const)))(
    'the player on the opened page sees overdue and paused, never updated: %s %s',
    (overdue, paused) => {
      expect(
        assignmentBadges({ audience: 'player', opened: true, overdue, paused }),
      ).toStrictEqual({ overdue, paused, forked: false, updated: false });
    },
  );

  it.each(combos)(
    'the coach sees overdue, paused and forked, never updated: %s %s %s',
    (overdue, paused, forked) => {
      expect(
        assignmentBadges({ audience: 'coach', overdue, paused, forked }),
      ).toStrictEqual({ overdue, paused, forked, updated: false });
    },
  );

  it('a forked status reaches the coach as forked alone (R-128)', () => {
    const status = assignmentStatus(
      { deadline: '2026-01-01', done: false, paused: true, forked: true },
      new Date('2026-11-02T10:00:00Z'),
    );
    expect(assignmentBadges({ audience: 'coach', ...status })).toStrictEqual({
      overdue: false,
      paused: false,
      forked: true,
      updated: false,
    });
  });
});

describe('coachAssignmentBadges (R-46, R-128, R-129, R-132)', () => {
  const now = new Date('2026-11-02T10:00:00Z'); // 2 Nov in Vilnius
  const record = (over: Partial<AssignmentFacts> = {}): AssignmentFacts => ({
    playerId: 'p',
    repertoireId: 'r',
    coachId: 'c',
    reaches: [
      {
        assignmentId: 'a-1',
        deadline: '2026-11-01',
        assignedVersion: 1,
        joinedAt: null,
      },
    ],
    pausedAt: null,
    seenVersion: null,
    forkedAt: null,
    ...over,
  });
  const badges = (over: Partial<BadgeSet>): BadgeSet => ({
    overdue: false,
    paused: false,
    forked: false,
    updated: false,
    ...over,
  });
  const PAST = new Date('2026-10-20T10:00:00Z');

  it.each([
    [
      'past its deadline and not done: overdue',
      record(),
      false,
      badges({ overdue: true }),
    ],
    ['done: never overdue', record(), true, badges({})],
    [
      'paused past its deadline: paused and still overdue',
      record({ pausedAt: PAST }),
      false,
      badges({ paused: true, overdue: true }),
    ],
    [
      'paused and done: paused alone',
      record({ pausedAt: PAST }),
      true,
      badges({ paused: true }),
    ],
    [
      'forked: forked alone',
      record({ forkedAt: PAST, pausedAt: PAST }),
      false,
      badges({ forked: true }),
    ],
  ] as const)('%s', (_name, facts, done, expected) => {
    expect(coachAssignmentBadges(facts, { done, now })).toStrictEqual(expected);
  });

  it('is assignmentStatusOf then assignmentBadges for the coach', () => {
    const facts = record({ pausedAt: PAST });
    const { overdue, paused, forked } = assignmentStatusOf(facts, {
      done: false,
      now,
    });
    expect(coachAssignmentBadges(facts, { done: false, now })).toStrictEqual(
      assignmentBadges({ audience: 'coach', overdue, paused, forked }),
    );
  });
});
