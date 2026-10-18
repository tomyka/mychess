import { describe, expect, it } from 'vitest';
import {
  ACCESS_REFUSALS,
  canCoachSee,
  type CoachAccessFacts,
  type CoachSubject,
} from './coach-access';

const linked: CoachAccessFacts = {
  linked: true,
  sharedRepertoireIds: new Set(['r-shared']),
};
const unlinked: CoachAccessFacts = {
  linked: false,
  sharedRepertoireIds: new Set(['r-shared']),
};
const ok = { ok: true, value: undefined };
const refused = (reason: string) => ({ ok: false, refusal: { reason } });
const profile: CoachSubject = { kind: 'profile' };
const repertoire = (repertoireId: string): CoachSubject => ({
  kind: 'repertoire',
  repertoireId,
});

describe('ACCESS_REFUSALS', () => {
  it('are message-catalogue keys', () => {
    expect(ACCESS_REFUSALS).toStrictEqual({
      notLinked: 'access.notLinked',
      notShared: 'access.notShared',
    });
  });
});

interface Case {
  readonly coachId: string;
  readonly playerId: string;
  readonly subject: CoachSubject;
  readonly facts: CoachAccessFacts;
  readonly expected: unknown;
}

const c = (over: Partial<Case> & Pick<Case, 'expected'>): Case => ({
  coachId: 'c',
  playerId: 'p',
  subject: profile,
  facts: linked,
  ...over,
});

describe('canCoachSee (R-13, R-39, R-42; checklist 1-3)', () => {
  it.each<[string, Case]>([
    ['a linked coach sees the display name', c({ expected: ok })],
    [
      'an unlinked coach sees no profile',
      c({ facts: unlinked, expected: refused('access.notLinked') }),
    ],
    [
      'a linked coach sees a repertoire shared with them',
      c({ subject: repertoire('r-shared'), expected: ok }),
    ],
    [
      'a linked coach does not see an unshared repertoire',
      c({
        subject: repertoire('r-own'),
        expected: refused('access.notShared'),
      }),
    ],
    // After unlink the shares are gone too, but the rule does not rely on it.
    [
      'an unlinked coach does not see even a shared one',
      c({
        subject: repertoire('r-shared'),
        facts: unlinked,
        expected: refused('access.notLinked'),
      }),
    ],
    // Facts claiming a self link can only be a bug; the rule refuses anyway.
    [
      'nobody is their own coach',
      c({ coachId: 'p', expected: refused('access.notLinked') }),
    ],
    [
      'nobody is their own coach, even for a shared repertoire',
      c({
        coachId: 'p',
        subject: repertoire('r-shared'),
        expected: refused('access.notLinked'),
      }),
    ],
  ])('%s', (_, { coachId, playerId, subject, facts, expected }) => {
    expect(canCoachSee(coachId, playerId, subject, facts)).toStrictEqual(
      expected,
    );
  });
});
