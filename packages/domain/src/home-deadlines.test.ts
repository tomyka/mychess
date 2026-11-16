import { importPgn, playerKeys, type RepertoireGraph } from '@mychess/chess';
import { describe, expect, it } from 'vitest';
import type { AssignmentFacts } from './assignment';
import type { CoachProgressFacts } from './coach-progress';
import {
  NO_DEADLINES,
  deadlineAssignments,
  playerDeadlines,
} from './home-deadlines';

/** 26 October in Vilnius. */
const NOW = new Date('2026-10-26T09:00:00Z');

function graphOf(pgn: string): RepertoireGraph {
  const imported = importPgn(pgn, 'white');
  if (!imported.ok) throw new Error(imported.refusal.reason);
  return imported.value.graph;
}

/** Every repertoire holds 1. e4: one player move. */
const GRAPH = graphOf('1. e4 e5 *');
const DONE = new Set(playerKeys(GRAPH));

const assignment = (
  repertoireId: string,
  deadline: string | null,
  extra: Partial<AssignmentFacts> = {},
): AssignmentFacts => ({
  playerId: 'p',
  repertoireId,
  coachId: 'c',
  reaches: [
    {
      assignmentId: repertoireId,
      deadline,
      assignedVersion: 1,
      joinedAt: null,
    },
  ],
  pausedAt: null,
  seenVersion: null,
  forkedAt: null,
  ...extra,
});

const facts = (
  assignments: readonly AssignmentFacts[],
  extra: Partial<CoachProgressFacts> = {},
): CoachProgressFacts => ({
  linked: true,
  sharedRepertoireIds: new Set(),
  assignments,
  sharedForks: [],
  ...extra,
});

/** Graphs for every repertoire named, and the player's tracked keys. */
const reads = (
  ids: readonly string[],
  tracked: ReadonlySet<string> = new Set(),
) => ({
  graphs: new Map(ids.map((id) => [id, GRAPH])),
  tracked,
  now: NOW,
});

describe('playerDeadlines (#329)', () => {
  it('is the earliest deadline of the live assignments not done, not overdue before it passes', () => {
    const f = facts([
      assignment('a', '2026-11-30'),
      assignment('b', '2026-11-05'),
      assignment('none', null),
    ]);
    expect(playerDeadlines('c', 'p', f, reads(['a', 'b', 'none']))).toEqual({
      nearestDeadline: '2026-11-05',
      overdue: false,
    });
  });

  it('is overdue from the day after a deadline passed undone, which is then the nearest', () => {
    const f = facts([
      assignment('a', '2026-11-30'),
      assignment('late', '2026-10-25'),
    ]);
    expect(playerDeadlines('c', 'p', f, reads(['a', 'late']))).toEqual({
      nearestDeadline: '2026-10-25',
      overdue: true,
    });
  });

  it('is not overdue on the deadline day itself', () => {
    const f = facts([assignment('today', '2026-10-26')]);
    expect(playerDeadlines('c', 'p', f, reads(['today']))).toEqual({
      nearestDeadline: '2026-10-26',
      overdue: false,
    });
  });

  it('leaves out a done assignment, past its deadline or not', () => {
    const f = facts([assignment('late', '2026-10-01')]);
    expect(playerDeadlines('c', 'p', f, reads(['late'], DONE))).toEqual({
      nearestDeadline: null,
      overdue: false,
    });
  });

  it('counts a paused assignment', () => {
    const f = facts([assignment('late', '2026-10-01', { pausedAt: NOW })]);
    expect(playerDeadlines('c', 'p', f, reads(['late']))).toEqual({
      nearestDeadline: '2026-10-01',
      overdue: true,
    });
  });

  it('takes a group deadline from the day the player joined, when later (R-16)', () => {
    const joined = assignment('g', '2026-10-20', {
      reaches: [
        {
          assignmentId: 'g',
          deadline: '2026-10-20',
          assignedVersion: 1,
          joinedAt: new Date('2026-10-27T09:00:00Z'),
        },
      ],
    });
    expect(playerDeadlines('c', 'p', facts([joined]), reads(['g']))).toEqual({
      nearestDeadline: '2026-10-27',
      overdue: false,
    });
  });

  it('leaves out forked, unreached, other coaches’ and other players’ assignments', () => {
    const f = facts([
      assignment('forked', '2026-10-01', { forkedAt: NOW }),
      assignment('gone', '2026-10-01', { reaches: [] }),
      assignment('theirs', '2026-10-01', { coachId: 'c2' }),
      assignment('other', '2026-10-01', { playerId: 'q' }),
    ]);
    const ids = ['forked', 'gone', 'theirs', 'other'];
    expect(playerDeadlines('c', 'p', f, reads(ids))).toEqual({
      nearestDeadline: null,
      overdue: false,
    });
  });

  it('leaves out an assignment whose repertoire was not read', () => {
    const f = facts([assignment('a', '2026-10-01')]);
    expect(playerDeadlines('c', 'p', f, reads([]))).toEqual({
      nearestDeadline: null,
      overdue: false,
    });
  });

  it('is nothing without a link, and to oneself', () => {
    const f = facts([assignment('a', '2026-10-01')], { linked: false });
    expect(playerDeadlines('c', 'p', f, reads(['a']))).toEqual({
      nearestDeadline: null,
      overdue: false,
    });
    const own = facts([assignment('a', '2026-10-01', { playerId: 'c' })]);
    expect(playerDeadlines('c', 'c', own, reads(['a']))).toEqual({
      nearestDeadline: null,
      overdue: false,
    });
  });
});

describe('deadlineAssignments (#329)', () => {
  it('is this coach’s live assignments of the player only, paused ones included', () => {
    const live = assignment('live', null);
    const paused = assignment('paused', null, { pausedAt: NOW });
    const f = facts([
      live,
      paused,
      assignment('forked', null, { forkedAt: NOW }),
      assignment('gone', null, { reaches: [] }),
      assignment('theirs', null, { coachId: 'c2' }),
      assignment('other', null, { playerId: 'q' }),
    ]);
    expect(deadlineAssignments('c', 'p', f)).toEqual([live, paused]);
  });

  it('is none without a link', () => {
    const f = facts([assignment('live', null)], { linked: false });
    expect(deadlineAssignments('c', 'p', f)).toEqual([]);
  });
});

describe('NO_DEADLINES', () => {
  it('is no deadline and nothing overdue', () => {
    expect(NO_DEADLINES).toEqual({ nearestDeadline: null, overdue: false });
  });
});
