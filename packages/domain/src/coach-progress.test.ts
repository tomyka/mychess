import { describe, expect, it } from 'vitest';
import type { AssignmentFacts } from './assignment';
import { ACCESS_REFUSALS } from './coach-access';
import {
  canCoachSeeProgress,
  isCoachLinked,
  progressRepertoireIds,
  type CoachProgressFacts,
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

const allowed = { ok: true, value: undefined };
const refused = (reason: string) => ({ ok: false, refusal: { reason } });

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

describe('canCoachSeeProgress (R-39, R-42, R-155)', () => {
  it('allows a repertoire the player shares with the coach', () => {
    expect(canCoachSeeProgress('c', 'p', 'shared', facts())).toEqual(allowed);
  });

  it('allows a live assignment, paused or not', () => {
    expect(canCoachSeeProgress('c', 'p', 'live', facts())).toEqual(allowed);
    expect(canCoachSeeProgress('c', 'p', 'paused', facts())).toEqual(allowed);
  });

  it('refuses a forked assignment as forked', () => {
    expect(canCoachSeeProgress('c', 'p', 'forked', facts())).toEqual(
      refused(ACCESS_REFUSALS.forked),
    );
  });

  it('allows a forked repertoire the player also shares with the coach', () => {
    const shared = facts({ sharedRepertoireIds: new Set(['forked']) });
    expect(canCoachSeeProgress('c', 'p', 'forked', shared)).toEqual(allowed);
  });

  it('refuses anything else as not shared', () => {
    expect(canCoachSeeProgress('c', 'p', 'private', facts())).toEqual(
      refused(ACCESS_REFUSALS.notShared),
    );
  });

  it('refuses an assignment that no longer reaches the player', () => {
    const gone = facts({ assignments: [assignment('live', { reaches: [] })] });
    expect(canCoachSeeProgress('c', 'p', 'live', gone)).toEqual(
      refused(ACCESS_REFUSALS.notShared),
    );
  });

  it('refuses another coach’s assignment of the same player', () => {
    const other = facts({
      assignments: [assignment('live', { coachId: 'c2' })],
    });
    expect(canCoachSeeProgress('c', 'p', 'live', other)).toEqual(
      refused(ACCESS_REFUSALS.notShared),
    );
  });

  it('refuses this coach’s assignment of another player', () => {
    const other = facts({
      assignments: [assignment('live', { playerId: 'p2' })],
    });
    expect(canCoachSeeProgress('c', 'p', 'live', other)).toEqual(
      refused(ACCESS_REFUSALS.notShared),
    );
  });

  it('refuses everything without a link, and to oneself', () => {
    for (const id of ['shared', 'live', 'forked']) {
      expect(
        canCoachSeeProgress('c', 'p', id, facts({ linked: false })),
      ).toEqual(refused(ACCESS_REFUSALS.notLinked));
    }
    expect(canCoachSeeProgress('p', 'p', 'shared', facts())).toEqual(
      refused(ACCESS_REFUSALS.notLinked),
    );
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

  it('agrees with canCoachSeeProgress on every repertoire', () => {
    const f = facts();
    const ids = progressRepertoireIds('c', 'p', f);
    for (const id of ['shared', 'live', 'paused', 'forked', 'private']) {
      expect(ids.has(id)).toBe(canCoachSeeProgress('c', 'p', id, f).ok);
    }
  });
});
