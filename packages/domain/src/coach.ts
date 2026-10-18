import type { Result } from '@mychess/chess';
import { z } from 'zod';
import { entitlementLimits, type Entitlement } from './account';

/** Message-catalogue keys for Coach refusals; the UI translates them. */
export const COACH_REFUSALS = {
  notCoach: 'coach.notCoach',
  stillLinked: 'coach.stillLinked',
  groupLimit: 'coach.groupLimit',
  groupNotFound: 'coach.groupNotFound',
  notLinked: 'coach.notLinked',
} as const;

export interface CoachRefusal {
  readonly reason: (typeof COACH_REFUSALS)[keyof typeof COACH_REFUSALS];
}

type CoachResult = Result<undefined, CoachRefusal>;

const OK: CoachResult = { ok: true, value: undefined };
const refuse = <T>(
  reason: CoachRefusal['reason'],
): Result<T, CoachRefusal> => ({
  ok: false,
  refusal: { reason },
});

/**
 * An account's Coach mode state: when it switched Coach mode on (R-11,
 * R-13), null when off. Read from `accounts.coach_since`.
 */
export interface CoachState {
  readonly coachSince: Date | null;
}

/** What deciding a coach action needs to know about the account. */
export interface CoachFacts extends CoachState {
  readonly entitlement: Entitlement;
}

/** Has the account switched Coach mode on (R-11, R-13)? */
export function isCoach(account: CoachState): boolean {
  return account.coachSince !== null;
}

/**
 * What switching Coach mode off does besides clearing it (R-109): the
 * coach's open invites are revoked at once; the groups are kept. "Open" is
 * an invite whose `inviteState` is `active`, so used and expired invites
 * keep their state.
 */
export interface StopCoaching {
  readonly revokeOpenInvites: true;
}

/** Coach mode goes off only once no player is linked (R-100, R-109). */
export function canStopCoaching(
  linkCount: number,
): Result<StopCoaching, CoachRefusal> {
  return linkCount === 0
    ? { ok: true, value: { revokeOpenInvites: true } }
    : refuse(COACH_REFUSALS.stillLinked);
}

/** A coach may have as many groups as the entitlement allows (R-70). */
export function canCreateGroup(
  coach: CoachFacts,
  groupCount: number,
): CoachResult {
  if (!isCoach(coach)) return refuse(COACH_REFUSALS.notCoach);
  return groupCount < entitlementLimits(coach.entitlement).coachGroups
    ? OK
    : refuse(COACH_REFUSALS.groupLimit);
}

/** Only a coach issues invites (R-12). */
export function canInvite(coach: CoachFacts): CoachResult {
  return isCoach(coach) ? OK : refuse(COACH_REFUSALS.notCoach);
}

/** The most characters a group name may have. */
export const GROUP_NAME_MAX = 60;

/** Message-catalogue keys for group name issues. */
export const GROUP_NAME_ISSUES = {
  blank: 'groupName.blank',
  tooLong: 'groupName.tooLong',
} as const;

/** A Group's name: trimmed, never blank, at most GROUP_NAME_MAX characters. */
export const groupNameSchema = z
  .string()
  .trim()
  .min(1, GROUP_NAME_ISSUES.blank)
  .max(GROUP_NAME_MAX, GROUP_NAME_ISSUES.tooLong);
