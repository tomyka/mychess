import { describe, expect, it } from 'vitest';
import {
  COACH_REFUSALS,
  GROUP_NAME_ISSUES,
  GROUP_NAME_MAX,
  OPEN_INVITE_LIMIT,
  canAddMember,
  canChangeGroups,
  canCreateGroup,
  canInvite,
  canStopCoaching,
  groupNameSchema,
  isCoach,
} from './coach';

const coach = {
  coachSince: new Date('2026-10-17T08:00:00Z'),
  entitlement: 'free' as const,
};
const notCoach = { coachSince: null, entitlement: 'free' as const };
const ok = { ok: true, value: undefined };
const refused = (reason: string) => ({ ok: false, refusal: { reason } });

describe('COACH_REFUSALS', () => {
  it('are the message-catalogue keys the UI translates', () => {
    expect(COACH_REFUSALS).toStrictEqual({
      notCoach: 'coach.notCoach',
      stillLinked: 'coach.stillLinked',
      groupLimit: 'coach.groupLimit',
      groupNotFound: 'coach.groupNotFound',
      notLinked: 'coach.notLinked',
      inviteLimit: 'coach.inviteLimit',
    });
  });
});

describe('isCoach', () => {
  it('is true once Coach mode was switched on (R-11, R-13)', () => {
    expect(isCoach(coach)).toBe(true);
  });
  it('is false for an account that never switched it on', () => {
    expect(isCoach(notCoach)).toBe(false);
  });
});

describe('canStopCoaching (R-100, R-109)', () => {
  it('allows switching off with no linked player', () => {
    expect(canStopCoaching(0)).toStrictEqual(ok);
  });
  it.each([1, 30])('refuses with %i linked players', (count) => {
    expect(canStopCoaching(count)).toStrictEqual(
      refused(COACH_REFUSALS.stillLinked),
    );
  });
});

describe('canCreateGroup (R-70: 10 groups)', () => {
  it.each([0, 9])('allows a coach with %i groups', (count) => {
    expect(canCreateGroup(coach, count)).toStrictEqual(ok);
  });
  it.each([10, 11])('refuses a coach with %i groups', (count) => {
    expect(canCreateGroup(coach, count)).toStrictEqual(
      refused(COACH_REFUSALS.groupLimit),
    );
  });
  it('refuses an account without Coach mode', () => {
    expect(canCreateGroup(notCoach, 0)).toStrictEqual(
      refused(COACH_REFUSALS.notCoach),
    );
  });
});

describe('canInvite (R-12, R-114: 50 open invites)', () => {
  it('allows at most 50 open invites', () => {
    expect(OPEN_INVITE_LIMIT).toBe(50);
  });
  it.each([0, 49])('allows a coach with %i open invites', (open) => {
    expect(canInvite(coach, open)).toStrictEqual(ok);
  });
  it.each([50, 51])('refuses a coach with %i open invites', (open) => {
    expect(canInvite(coach, open)).toStrictEqual(
      refused(COACH_REFUSALS.inviteLimit),
    );
  });
  it.each([0, 50])(
    'refuses an account without Coach mode (%i open invites)',
    (open) => {
      expect(canInvite(notCoach, open)).toStrictEqual(
        refused(COACH_REFUSALS.notCoach),
      );
    },
  );
});

describe('canChangeGroups (R-113)', () => {
  it('allows a coach in Coach mode', () => {
    expect(canChangeGroups(coach)).toStrictEqual(ok);
  });
  it('refuses while Coach mode is off: the groups are read-only', () => {
    expect(canChangeGroups(notCoach)).toStrictEqual(
      refused(COACH_REFUSALS.notCoach),
    );
  });
});

describe('canAddMember (R-12)', () => {
  it("allows a linked player into the coach's own group", () => {
    expect(canAddMember({ ownsGroup: true, linked: true })).toStrictEqual(ok);
  });
  it.each([true, false])(
    "refuses a group that is not the coach's own (linked: %s)",
    (linked) => {
      expect(canAddMember({ ownsGroup: false, linked })).toStrictEqual(
        refused(COACH_REFUSALS.groupNotFound),
      );
    },
  );
  it('refuses a player who is not linked to the coach', () => {
    expect(canAddMember({ ownsGroup: true, linked: false })).toStrictEqual(
      refused(COACH_REFUSALS.notLinked),
    );
  });
});

describe('groupNameSchema', () => {
  it('allows names of up to 60 characters', () => {
    expect(GROUP_NAME_MAX).toBe(60);
  });
  it('trims the name', () => {
    expect(groupNameSchema.parse('  Šeštadienio grupė ')).toBe(
      'Šeštadienio grupė',
    );
  });
  it('takes exactly 60 characters', () => {
    expect(groupNameSchema.parse('a'.repeat(60))).toHaveLength(60);
  });
  it('takes a single character', () => {
    expect(groupNameSchema.parse('A')).toBe('A');
  });
  it('measures the length after trimming', () => {
    expect(groupNameSchema.parse(` ${'a'.repeat(60)} `)).toHaveLength(60);
  });
  it.each([
    ['blank', '   ', 'groupName.blank'],
    ['empty', '', 'groupName.blank'],
    ['61 characters', 'a'.repeat(61), 'groupName.tooLong'],
  ])('refuses %s with a catalogue key', (_, raw, issue) => {
    expect(groupNameSchema.safeParse(raw).error?.issues[0]?.message).toBe(
      issue,
    );
  });
  it('names its issues by catalogue key', () => {
    expect(GROUP_NAME_ISSUES).toStrictEqual({
      blank: 'groupName.blank',
      tooLong: 'groupName.tooLong',
    });
  });
});
