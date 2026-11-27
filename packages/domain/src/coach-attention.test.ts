import { describe, expect, it } from 'vitest';
import type { ProgressCounts } from '@mychess/chess';
import {
  ATTENTION_ORDER,
  DUE_PILE,
  IDLE_DAYS,
  NEAR_DEADLINE_DAYS,
  NEAR_DEADLINE_PERCENT,
  attentionOf,
  byAttention,
  deadlineNearness,
  nearestAssignment,
  playerSummary,
  type Attention,
  type AttentionInput,
  type CoachRowFacts,
  type CoachRowStatus,
  type DatedAssignment,
} from './coach-attention';

const NOW = new Date('2026-11-27T10:00:00Z'); // Vilnius 27 Nov
const counts = (c: Partial<ProgressCounts>): ProgressCounts => ({
  notStarted: 0,
  skipped: 0,
  due: 0,
  learned: 0,
  ...c,
});
const status = (s: Partial<CoachRowStatus>): CoachRowStatus => ({
  deadline: null,
  overdue: false,
  paused: false,
  done: false,
  forked: false,
  ...s,
});
const assigned = (over: Partial<CoachRowFacts> = {}): CoachRowFacts => ({
  name: 'Slav',
  status: status({}),
  counts: counts({ notStarted: 10 }),
  ...over,
});
const shared = (name: string, c: ProgressCounts): CoachRowFacts => ({
  name,
  status: null,
  counts: c,
});
const input = (over: Partial<AttentionInput>): AttentionInput => ({
  rows: [],
  lastTrained: NOW,
  linkedAt: new Date('2026-10-01T10:00:00Z'),
  ...over,
});

describe('the R-229 thresholds', () => {
  it('are 3 days, 80%, 30 due and 7 days', () => {
    expect([
      NEAR_DEADLINE_DAYS,
      NEAR_DEADLINE_PERCENT,
      DUE_PILE,
      IDLE_DAYS,
    ]).toEqual([3, 80, 30, 7]);
  });
});

describe('attentionOf (R-229)', () => {
  it('is null for a player with nothing to flag', () => {
    expect(attentionOf(input({ rows: [assigned()] }), NOW)).toBeNull();
  });

  it('is null for a player with nothing the coach may see', () => {
    expect(attentionOf(input({ rows: [], lastTrained: null }), NOW)).toBeNull();
  });

  it('flags an overdue assignment first, paused ones too (R-132)', () => {
    const rows = [
      assigned({
        name: 'Italian',
        status: status({ overdue: true, paused: true, deadline: '2026-11-25' }),
      }),
      assigned({
        name: 'Slav',
        status: status({ deadline: '2026-11-28' }),
        counts: counts({ learned: 1, notStarted: 9 }),
      }),
    ];
    expect(attentionOf(input({ rows }), NOW)).toEqual({
      kind: 'overdue',
      repertoires: ['Italian'],
      days: 2,
    });
  });

  it('names every overdue repertoire and counts the most overdue', () => {
    const rows = [
      assigned({
        name: 'Italian',
        status: status({ overdue: true, deadline: '2026-11-26' }),
      }),
      assigned({
        name: 'Slav',
        status: status({ overdue: true, deadline: '2026-11-22' }),
      }),
    ];
    expect(attentionOf(input({ rows }), NOW)).toEqual({
      kind: 'overdue',
      repertoires: ['Italian', 'Slav'],
      days: 5,
    });
  });

  it('counts 0 days, not -0, for one overdue on its deadline day', () => {
    const rows = [
      assigned({ status: status({ overdue: true, deadline: '2026-11-27' }) }),
    ];
    const reason = attentionOf(input({ rows }), NOW);
    expect(reason?.kind === 'overdue' ? reason.days : undefined).toBe(0);
  });

  it('flags a deadline within 3 days under 80% learned, not done', () => {
    const rows = [
      assigned({
        status: status({ deadline: '2026-11-30' }),
        counts: counts({ learned: 3, notStarted: 97 }),
      }),
    ];
    expect(attentionOf(input({ rows }), NOW)).toEqual({
      kind: 'deadlineNear',
      repertoire: 'Slav',
      days: 3,
      percent: 3,
    });
  });

  it('flags a deadline due today at 79% learned', () => {
    const rows = [
      assigned({
        status: status({ deadline: '2026-11-27' }),
        counts: counts({ learned: 79, notStarted: 21 }),
      }),
    ];
    expect(attentionOf(input({ rows }), NOW)).toEqual({
      kind: 'deadlineNear',
      repertoire: 'Slav',
      days: 0,
      percent: 79,
    });
  });

  it('names the nearest of several near deadlines', () => {
    const rows = [
      assigned({ name: 'Italian', status: status({ deadline: '2026-11-29' }) }),
      assigned({ name: 'Slav', status: status({ deadline: '2026-11-28' }) }),
      assigned({
        name: 'Taimanov',
        status: status({ deadline: '2026-11-30' }),
      }),
    ];
    expect(attentionOf(input({ rows }), NOW)).toEqual({
      kind: 'deadlineNear',
      repertoire: 'Slav',
      days: 1,
      percent: 0,
    });
  });

  it('does not flag a deadline 4 days away, or one at 80%, or a done one', () => {
    const far = assigned({ status: status({ deadline: '2026-12-01' }) });
    const at80 = assigned({
      status: status({ deadline: '2026-11-28' }),
      counts: counts({ learned: 8, notStarted: 2 }),
    });
    const done = assigned({
      status: status({ deadline: '2026-11-28', done: true }),
    });
    for (const row of [far, at80, done])
      expect(attentionOf(input({ rows: [row] }), NOW)).toBeNull();
  });

  it('does not call a passed deadline near (overdue covers it)', () => {
    const rows = [assigned({ status: status({ deadline: '2026-11-26' }) })];
    expect(attentionOf(input({ rows }), NOW)).toBeNull();
  });

  it('does not call a near deadline without counts, or of an empty repertoire, near', () => {
    const noCounts = assigned({
      status: status({ deadline: '2026-11-28' }),
      counts: null,
    });
    const empty = assigned({
      status: status({ deadline: '2026-11-28' }),
      counts: counts({}),
    });
    for (const row of [noCounts, empty])
      expect(attentionOf(input({ rows: [row] }), NOW)).toBeNull();
  });

  it('flags 30 or more due moves across what the coach sees', () => {
    const rows = [
      assigned({ counts: counts({ due: 20, learned: 5 }) }),
      shared('Taimanov', counts({ due: 10 })),
    ];
    expect(attentionOf(input({ rows }), NOW)).toEqual({
      kind: 'duePile',
      due: 30,
    });
    expect(attentionOf(input({ rows: rows.slice(0, 1) }), NOW)).toBeNull();
  });

  it('does not count 29 due moves as a pile-up', () => {
    const rows = [shared('Taimanov', counts({ due: 29 }))];
    expect(attentionOf(input({ rows }), NOW)).toBeNull();
  });

  it('flags 7 days idle with an unfinished, unpaused assignment', () => {
    const rows = [assigned()];
    const lastTrained = new Date('2026-11-20T10:00:00Z');
    expect(attentionOf(input({ rows, lastTrained }), NOW)).toEqual({
      kind: 'idle',
      days: 7,
      since: 'training',
    });
    expect(
      attentionOf(
        input({ rows, lastTrained: new Date('2026-11-21T10:00:00Z') }),
        NOW,
      ),
    ).toBeNull();
    const paused = [assigned({ status: status({ paused: true }) })];
    expect(attentionOf(input({ rows: paused, lastTrained }), NOW)).toBeNull();
  });

  it('does not flag idle on done assignments or shares alone', () => {
    const lastTrained = new Date('2026-11-01T10:00:00Z');
    const done = [assigned({ status: status({ done: true }) })];
    const shares = [shared('Taimanov', counts({ notStarted: 10 }))];
    for (const rows of [done, shares])
      expect(attentionOf(input({ rows, lastTrained }), NOW)).toBeNull();
  });

  it('flags idle when one assignment is unfinished beside a done one', () => {
    const rows = [
      assigned({ status: status({ done: true }) }),
      assigned({ name: 'Italian' }),
    ];
    const lastTrained = new Date('2026-11-17T10:00:00Z');
    expect(attentionOf(input({ rows, lastTrained }), NOW)).toEqual({
      kind: 'idle',
      days: 10,
      since: 'training',
    });
  });

  it('counts a never-trained player from the link day, and says so', () => {
    const rows = [assigned()];
    expect(
      attentionOf(
        input({
          rows,
          lastTrained: null,
          linkedAt: new Date('2026-11-20T10:00:00Z'),
        }),
        NOW,
      ),
    ).toEqual({ kind: 'idle', days: 7, since: 'link' });
    expect(
      attentionOf(
        input({
          rows,
          lastTrained: null,
          linkedAt: new Date('2026-11-25T10:00:00Z'),
        }),
        NOW,
      ),
    ).toBeNull();
  });

  it('counts idle days in Vilnius, not UTC', () => {
    // 20 Nov 22:30 UTC is already 21 Nov in Vilnius: 6 days, not 7.
    const rows = [assigned()];
    const lastTrained = new Date('2026-11-20T22:30:00Z');
    expect(attentionOf(input({ rows, lastTrained }), NOW)).toBeNull();
  });

  it('never flags a forked assignment (R-155)', () => {
    const rows = [
      assigned({
        status: status({ forked: true, deadline: '2026-11-20' }),
        counts: null,
      }),
    ];
    expect(attentionOf(input({ rows, lastTrained: null }), NOW)).toBeNull();
  });

  it('leaves a forked row out of the due pile-up, even with counts (R-155)', () => {
    const forked = assigned({
      status: status({ forked: true }),
      counts: counts({ due: 40 }),
    });
    expect(attentionOf(input({ rows: [forked] }), NOW)).toBeNull();
    const withShare = [forked, shared('Taimanov', counts({ due: 30 }))];
    expect(attentionOf(input({ rows: withShare }), NOW)).toEqual({
      kind: 'duePile',
      due: 30,
    });
  });

  it('counts deadlines from the Vilnius day just after midnight', () => {
    const justAfter = new Date('2026-11-26T22:30:00Z'); // 00:30 27 Nov Vilnius
    const near = [assigned({ status: status({ deadline: '2026-11-30' }) })];
    expect(
      attentionOf(input({ rows: near, lastTrained: justAfter }), justAfter),
    ).toEqual({
      kind: 'deadlineNear',
      repertoire: 'Slav',
      days: 3,
      percent: 0,
    });
    const late = [
      assigned({ status: status({ overdue: true, deadline: '2026-11-26' }) }),
    ];
    expect(
      attentionOf(input({ rows: late, lastTrained: justAfter }), justAfter),
    ).toEqual({ kind: 'overdue', repertoires: ['Slav'], days: 1 });
  });

  it('ranks a near deadline above a due pile-up and idleness', () => {
    const rows = [
      assigned({
        status: status({ deadline: '2026-11-28' }),
        counts: counts({ due: 40 }),
      }),
    ];
    const lastTrained = new Date('2026-11-01T10:00:00Z');
    expect(attentionOf(input({ rows, lastTrained }), NOW)).toMatchObject({
      kind: 'deadlineNear',
    });
  });

  it('ranks a due pile-up above idleness', () => {
    const rows = [assigned({ counts: counts({ due: 30, notStarted: 5 }) })];
    const lastTrained = new Date('2026-11-01T10:00:00Z');
    expect(attentionOf(input({ rows, lastTrained }), NOW)).toEqual({
      kind: 'duePile',
      due: 30,
    });
  });
});

describe('byAttention (R-229, R-160)', () => {
  const overdue: Attention = {
    kind: 'overdue',
    repertoires: ['Slav'],
    days: 1,
  };
  const near: Attention = {
    kind: 'deadlineNear',
    repertoire: 'Slav',
    days: 1,
    percent: 10,
  };
  const pile: Attention = { kind: 'duePile', due: 30 };
  const idle: Attention = { kind: 'idle', days: 7, since: 'training' };
  const card = (name: string, id: string, reason: Attention) => ({
    player: { id, displayName: name },
    reason,
  });
  /** The order of cards shaped as the loader shapes them. */
  const order = byAttention((one: ReturnType<typeof card>) => ({
    name: one.player.displayName,
    id: one.player.id,
    reason: one.reason,
  }));

  it('ranks overdue, then a near deadline, a due pile-up, idleness', () => {
    expect(ATTENTION_ORDER).toEqual([
      'overdue',
      'deadlineNear',
      'duePile',
      'idle',
    ]);
    const cards = [
      card('Ada', 'a', idle),
      card('Ben', 'b', pile),
      card('Cy', 'c', near),
      card('Dan', 'd', overdue),
    ];
    expect(cards.toSorted(order).map((c) => c.player.displayName)).toEqual([
      'Dan',
      'Cy',
      'Ben',
      'Ada',
    ]);
  });

  it('breaks a tie of reasons by name, then by id', () => {
    const cards = [
      card('Zoe', 'z', pile),
      card('ada', 'a2', pile),
      card('Ada', 'a1', pile),
      card('Ben', 'b', pile),
    ];
    expect(cards.toSorted(order).map((c) => c.player.id)).toEqual([
      'a2',
      'a1',
      'b',
      'z',
    ]);
  });
});

describe('playerSummary', () => {
  it('sums the counts it may see, the earliest open deadline, and all done', () => {
    const rows = [
      assigned({
        status: status({ deadline: '2026-12-20' }),
        counts: counts({ learned: 5, due: 5 }),
      }),
      assigned({
        status: status({ deadline: '2026-11-30', done: true }),
        counts: counts({ learned: 10 }),
      }),
      shared('Taimanov', counts({ notStarted: 10, skipped: 2 })),
    ];
    expect(playerSummary(rows)).toEqual({
      counts: counts({ learned: 15, due: 5, notStarted: 10, skipped: 2 }),
      nextDeadline: '2026-12-20',
      allDone: false,
      overdue: false,
    });
  });

  it('is overdue when a live assignment is overdue, paused or not', () => {
    const rows = [
      assigned({ status: status({ deadline: '2026-12-20' }) }),
      assigned({
        status: status({ deadline: '2026-10-01', overdue: true, paused: true }),
      }),
    ];
    expect(playerSummary(rows).overdue).toBe(true);
  });

  it('is never overdue for a forked assignment (R-155) or a share', () => {
    const rows = [
      assigned({
        status: status({ deadline: '2026-10-01', overdue: true, forked: true }),
        counts: null,
      }),
      shared('Taimanov', counts({ due: 3 })),
    ];
    expect(playerSummary(rows).overdue).toBe(false);
  });

  it('takes the earliest of several open deadlines', () => {
    const rows = [
      assigned({ status: status({ deadline: '2026-12-20' }) }),
      assigned({ status: status({ deadline: '2026-12-02' }) }),
      assigned({ status: status({ deadline: null }) }),
    ];
    expect(playerSummary(rows).nextDeadline).toBe('2026-12-02');
  });

  it('leaves out a forked assignment and its deadline (R-155)', () => {
    const rows = [
      assigned({
        status: status({ forked: true, deadline: '2026-12-01' }),
        counts: null,
      }),
    ];
    expect(playerSummary(rows)).toEqual({
      counts: null,
      nextDeadline: null,
      allDone: false,
      overdue: false,
    });
  });

  it('leaves a forked row out of the counts, even with counts (R-155)', () => {
    const forked = assigned({
      status: status({ forked: true }),
      counts: counts({ due: 40 }),
    });
    expect(playerSummary([forked]).counts).toBeNull();
    const share = counts({ learned: 4 });
    expect(playerSummary([forked, shared('Taimanov', share)]).counts).toEqual(
      share,
    );
  });

  it('sums only the rows that carry counts', () => {
    const share = counts({ due: 3 });
    const rows = [assigned({ counts: null }), shared('Taimanov', share)];
    expect(playerSummary(rows).counts).toEqual(share);
  });

  it('is all done when every live assignment is done', () => {
    const rows = [
      assigned({ status: status({ done: true }) }),
      shared('Taimanov', counts({ notStarted: 10 })),
    ];
    expect(playerSummary(rows).allDone).toBe(true);
  });

  it('is not all done with shares alone', () => {
    const rows = [shared('Taimanov', counts({ learned: 10 }))];
    expect(playerSummary(rows).allDone).toBe(false);
  });

  it('has no counts when nothing is visible', () => {
    expect(playerSummary([])).toEqual({
      counts: null,
      nextDeadline: null,
      allDone: false,
      overdue: false,
    });
  });
});

describe('nearestAssignment', () => {
  const one = (repertoireName: string, deadline: string | null) => ({
    repertoireName,
    deadline,
  });

  it('takes the earliest deadline, past ones too', () => {
    expect(
      nearestAssignment([
        one('Italian', '2026-12-20'),
        one('No date', null),
        one('Slav', '2026-11-20'),
      ]),
    ).toEqual(one('Slav', '2026-11-20'));
  });

  it('breaks a tie of deadlines by name', () => {
    expect(
      nearestAssignment([
        one('Slav', '2026-12-01'),
        one('Italian', '2026-12-01'),
      ]),
    ).toEqual(one('Italian', '2026-12-01'));
  });

  it('takes the first by name when none has a deadline, and none of nothing', () => {
    expect(
      nearestAssignment([one('Slav', null), one('Italian', null)]),
    ).toEqual(one('Italian', null));
    expect(nearestAssignment<DatedAssignment>([])).toBeUndefined();
  });
});

describe('deadlineNearness (R-229, R-231)', () => {
  it.each([
    ['2026-11-27', 0, true],
    ['2026-11-30', 3, true],
    ['2026-12-01', 4, false],
    ['2026-11-26', -1, false],
    ['2026-11-01', -26, false],
  ])('counts %s from 27 Nov as %i days, near: %s', (deadline, days, near) => {
    expect(deadlineNearness(deadline, '2026-11-27')).toEqual({ days, near });
  });

  it('counts whole calendar days across the DST change', () => {
    expect(deadlineNearness('2026-10-26', '2026-10-24')).toEqual({
      days: 2,
      near: true,
    });
  });
});
