import { describe, expect, it } from 'vitest';
import type { AssignmentFacts } from './assignment';
import {
  isCoachLinked,
  progressRepertoire,
  progressRepertoireIds,
  progressRepertoires,
  type CoachProgressFacts,
  type ProgressRepertoire,
} from './coach-progress';

const T = new Date('2026-10-26T09:00:00Z');

const assignment = (
  repertoireId: string,
  extra: Partial<AssignmentFacts> = {},
): AssignmentFacts => ({
  playerId: 'p',
  repertoireId,
  coachId: 'c',
  reaches: [
    { assignmentId: 'a', deadline: null, assignedVersion: 1, joinedAt: null },
  ],
  pausedAt: null,
  seenVersion: null,
  forkedAt: null,
  ...extra,
});

const facts = (
  extra: Partial<CoachProgressFacts> = {},
): CoachProgressFacts => ({
  linked: true,
  sharedRepertoireIds: new Set(['shared']),
  assignments: [
    assignment('live'),
    assignment('paused', { pausedAt: T }),
    assignment('forked', { forkedAt: T }),
  ],
  ...extra,
});

const shared = (repertoireId: string): ProgressRepertoire => ({
  repertoireId,
  kind: 'granted',
  source: 'shared',
  assignment: null,
});
const assigned = (one: AssignmentFacts): ProgressRepertoire => ({
  repertoireId: one.repertoireId,
  kind: 'granted',
  source: 'assigned',
  assignment: one,
});
const forked = (one: AssignmentFacts): ProgressRepertoire => ({
  repertoireId: one.repertoireId,
  kind: 'forked',
  source: 'assigned',
  assignment: one,
});

const PAUSED = assignment('paused', { pausedAt: T });
const FORKED = assignment('forked', { forkedAt: T });

describe('isCoachLinked', () => {
  it('is true with an active link', () => {
    expect(isCoachLinked('c', 'p', facts())).toBe(true);
  });

  it('is true with a link even when nothing is shared or assigned', () => {
    const bare = facts({ sharedRepertoireIds: new Set(), assignments: [] });
    expect(isCoachLinked('c', 'p', bare)).toBe(true);
  });

  it('is false without a link, and to oneself', () => {
    expect(isCoachLinked('c', 'p', facts({ linked: false }))).toBe(false);
    expect(isCoachLinked('p', 'p', facts())).toBe(false);
  });
});

describe('progressRepertoire (R-39, R-42, R-155)', () => {
  it('grants a repertoire the player shares with the coach, as shared', () => {
    expect(progressRepertoire('c', 'p', 'shared', facts())).toEqual(
      shared('shared'),
    );
  });

  it('grants a live assignment, paused or not, with its assignment', () => {
    expect(progressRepertoire('c', 'p', 'live', facts())).toEqual(
      assigned(assignment('live')),
    );
    expect(progressRepertoire('c', 'p', 'paused', facts())).toEqual(
      assigned(PAUSED),
    );
  });

  it('shows a forked assignment as forked, with that assignment', () => {
    expect(progressRepertoire('c', 'p', 'forked', facts())).toEqual(
      forked(FORKED),
    );
  });

  it('grants a forked repertoire the player also shares, as shared', () => {
    const both = facts({ sharedRepertoireIds: new Set(['forked']) });
    expect(progressRepertoire('c', 'p', 'forked', both)).toEqual(
      shared('forked'),
    );
  });

  it('shows nothing else', () => {
    expect(progressRepertoire('c', 'p', 'private', facts())).toBeUndefined();
  });

  it('shows nothing of an assignment that no longer reaches the player', () => {
    const gone = facts({ assignments: [assignment('live', { reaches: [] })] });
    expect(progressRepertoire('c', 'p', 'live', gone)).toBeUndefined();
  });

  it('shows nothing of another coach’s assignment of the same player, forked or not', () => {
    const other = facts({
      assignments: [
        assignment('live', { coachId: 'c2' }),
        assignment('forked', { coachId: 'c2', forkedAt: T }),
      ],
    });
    expect(progressRepertoire('c', 'p', 'live', other)).toBeUndefined();
    expect(progressRepertoire('c', 'p', 'forked', other)).toBeUndefined();
  });

  it('shows nothing of this coach’s assignment of another player', () => {
    const other = facts({
      assignments: [assignment('live', { playerId: 'p2' })],
    });
    expect(progressRepertoire('c', 'p', 'live', other)).toBeUndefined();
  });

  it('shows nothing without a link, and to oneself', () => {
    for (const id of ['shared', 'live', 'forked']) {
      expect(
        progressRepertoire('c', 'p', id, facts({ linked: false })),
      ).toBeUndefined();
    }
    expect(progressRepertoire('p', 'p', 'shared', facts())).toBeUndefined();
    expect(progressRepertoire('p', 'p', 'forked', facts())).toBeUndefined();
  });
});

describe('progressRepertoires (R-151, R-155)', () => {
  it('lists this coach’s assignments, a forked one as forked, then the shared ones', () => {
    expect(progressRepertoires('c', 'p', facts())).toEqual([
      assigned(assignment('live')),
      assigned(PAUSED),
      forked(FORKED),
      shared('shared'),
    ]);
  });

  it('lists a forked repertoire the player also shares once, as shared', () => {
    const both = facts({ sharedRepertoireIds: new Set(['forked']) });
    expect(progressRepertoires('c', 'p', both)).toEqual([
      assigned(assignment('live')),
      assigned(PAUSED),
      shared('forked'),
    ]);
  });

  it('lists a repertoire assigned through two rows once', () => {
    const twice = facts({
      sharedRepertoireIds: new Set(),
      assignments: [assignment('live'), assignment('live')],
    });
    expect(progressRepertoires('c', 'p', twice)).toEqual([
      assigned(assignment('live')),
    ]);
  });

  it('leaves out another coach’s, another player’s and unreached assignments', () => {
    const others = facts({
      sharedRepertoireIds: new Set(),
      assignments: [
        assignment('other-coach', { coachId: 'c2' }),
        assignment('other-player', { playerId: 'p2' }),
        assignment('unreached', { reaches: [] }),
      ],
    });
    expect(progressRepertoires('c', 'p', others)).toEqual([]);
  });

  it('is empty without a link, and to oneself', () => {
    expect(progressRepertoires('c', 'p', facts({ linked: false }))).toEqual([]);
    expect(progressRepertoires('p', 'p', facts())).toEqual([]);
  });

  it('agrees with progressRepertoire on every repertoire it lists', () => {
    const f = facts();
    for (const one of progressRepertoires('c', 'p', f)) {
      expect(one).toEqual(progressRepertoire('c', 'p', one.repertoireId, f));
    }
  });
});

describe('progressRepertoireIds (R-154)', () => {
  it('is the shared and live assigned repertoires, never a forked one', () => {
    expect([...progressRepertoireIds('c', 'p', facts())].sort()).toEqual([
      'live',
      'paused',
      'shared',
    ]);
  });

  it('leaves out another coach’s, another player’s and unreached assignments', () => {
    const others = facts({
      sharedRepertoireIds: new Set(),
      assignments: [
        assignment('other-coach', { coachId: 'c2' }),
        assignment('other-player', { playerId: 'p2' }),
        assignment('unreached', { reaches: [] }),
      ],
    });
    expect(progressRepertoireIds('c', 'p', others).size).toBe(0);
  });

  it('is empty without a link, and to oneself', () => {
    expect(progressRepertoireIds('c', 'p', facts({ linked: false })).size).toBe(
      0,
    );
    expect(progressRepertoireIds('p', 'p', facts()).size).toBe(0);
  });

  it('agrees with progressRepertoire on every repertoire', () => {
    const f = facts();
    const ids = progressRepertoireIds('c', 'p', f);
    for (const id of ['shared', 'live', 'paused', 'forked', 'private']) {
      expect(ids.has(id)).toBe(
        progressRepertoire('c', 'p', id, f)?.kind === 'granted',
      );
    }
  });
});
