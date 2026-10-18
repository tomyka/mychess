import { describe, expect, it } from 'vitest';
import {
  COACH_REFUSALS,
  GROUP_NAME_ISSUES,
  GROUP_NAME_MAX,
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
  it('allows switching off with no linked player and revokes the open invites', () => {
    expect(canStopCoaching(0)).toStrictEqual({
      ok: true,
      value: { revokeOpenInvites: true },
    });
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

describe('canInvite', () => {
  it('allows a coach', () => {
    expect(canInvite(coach)).toStrictEqual(ok);
  });
  it('refuses an account without Coach mode', () => {
    expect(canInvite(notCoach)).toStrictEqual(refused(COACH_REFUSALS.notCoach));
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
