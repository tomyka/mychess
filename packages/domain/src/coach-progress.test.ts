import { describe, expect, it } from 'vitest';
import type { AssignmentFacts } from './assignment';
import {
  isCoachLinked,
  progressRepertoire,
  progressRepertoireIds,
  progressRepertoires,
  type CoachProgressFacts,
  type ProgressRepertoire,
  type SharedFork,
} from './coach-progress';

const T = new Date('2026-10-26T09:00:00Z');
const LATER = new Date('2026-10-27T09:00:00Z');

/** A shared fork of `sourceRepertoireId`, made at `createdAt`. */
const sharedFork = (
  repertoireId: string,
  sourceRepertoireId: string,
  createdAt = T,
): SharedFork => ({ repertoireId, sourceRepertoireId, createdAt });

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
  sharedForks: [],
  ...extra,
});

const shared = (
  repertoireId: string,
  forkOf: string | null = null,
): ProgressRepertoire => ({
  repertoireId,
  kind: 'granted',
  source: 'shared',
  assignment: null,
  forkOf,
});
const assigned = (one: AssignmentFacts): ProgressRepertoire => ({
  repertoireId: one.repertoireId,
  kind: 'granted',
  source: 'assigned',
  assignment: one,
});
const forked = (
  one: AssignmentFacts,
  sharedForkId: string | null = null,
): ProgressRepertoire => ({
  repertoireId: one.repertoireId,
  kind: 'forked',
  source: 'assigned',
  assignment: one,
  sharedForkId,
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

  it('names the fork of a forked assignment the player shares with the coach (#328, R-42)', () => {
    const sharing = facts({
      sharedRepertoireIds: new Set(['shared', 'fork']),
      sharedForks: [sharedFork('fork', 'forked')],
    });
    expect(progressRepertoire('c', 'p', 'forked', sharing)).toEqual(
      forked(FORKED, 'fork'),
    );
  });

  it('never names a fork the player does not share with this coach (R-39, R-43)', () => {
    const unshared = facts({
      sharedForks: [sharedFork('fork', 'forked')],
    });
    expect(progressRepertoire('c', 'p', 'forked', unshared)).toEqual(
      forked(FORKED),
    );
  });

  it('never names a shared fork of another repertoire', () => {
    const other = facts({
      sharedRepertoireIds: new Set(['fork']),
      sharedForks: [sharedFork('fork', 'elsewhere')],
    });
    expect(progressRepertoire('c', 'p', 'forked', other)).toEqual(
      forked(FORKED),
    );
  });

  it('names the newest shared fork when the player shares two of one assignment, whatever their order (R-128)', () => {
    const older = sharedFork('older', 'forked', T);
    const newer = sharedFork('newer', 'forked', LATER);
    for (const order of [
      [older, newer],
      [newer, older],
    ]) {
      const two = facts({
        sharedRepertoireIds: new Set(['newer', 'older']),
        sharedForks: order,
      });
      expect(progressRepertoire('c', 'p', 'forked', two)).toEqual(
        forked(FORKED, 'newer'),
      );
    }
  });

  it('names the greater id of two shared forks made at the same time', () => {
    for (const order of [
      [sharedFork('a', 'forked'), sharedFork('b', 'forked')],
      [sharedFork('b', 'forked'), sharedFork('a', 'forked')],
    ]) {
      const two = facts({
        sharedRepertoireIds: new Set(['a', 'b']),
        sharedForks: order,
      });
      expect(progressRepertoire('c', 'p', 'forked', two)).toEqual(
        forked(FORKED, 'b'),
      );
    }
  });

  it('names a shared fork over a newer one the player does not share', () => {
    const one = facts({
      sharedRepertoireIds: new Set(['older']),
      sharedForks: [
        sharedFork('older', 'forked', T),
        sharedFork('newer', 'forked', LATER),
      ],
    });
    expect(progressRepertoire('c', 'p', 'forked', one)).toEqual(
      forked(FORKED, 'older'),
    );
  });

  it('grants a forked repertoire the player also shares, as shared', () => {
    const both = facts({ sharedRepertoireIds: new Set(['forked']) });
    expect(progressRepertoire('c', 'p', 'forked', both)).toEqual(
      shared('forked'),
    );
  });

  it('says which of this coach’s repertoires a shared one is the player’s fork of (#328)', () => {
    const sharing = facts({
      sharedRepertoireIds: new Set(['shared', 'fork']),
      sharedForks: [sharedFork('fork', 'forked')],
    });
    expect(progressRepertoire('c', 'p', 'fork', sharing)).toEqual(
      shared('fork', 'forked'),
    );
    expect(progressRepertoire('c', 'p', 'shared', sharing)).toEqual(
      shared('shared'),
    );
  });

  it('never calls a fork the player does not share with this coach one (R-39, R-43)', () => {
    // The fork is shared with another coach only, so it is not this coach's to see.
    const elsewhere = facts({ sharedForks: [sharedFork('fork', 'forked')] });
    expect(progressRepertoire('c', 'p', 'fork', elsewhere)).toBeUndefined();
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

  it('lists a forked assignment with its shared fork, and the fork as shared (#328)', () => {
    const sharing = facts({
      sharedRepertoireIds: new Set(['fork']),
      sharedForks: [sharedFork('fork', 'forked')],
    });
    expect(progressRepertoires('c', 'p', sharing)).toEqual([
      assigned(assignment('live')),
      assigned(PAUSED),
      forked(FORKED, 'fork'),
      shared('fork', 'forked'),
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
