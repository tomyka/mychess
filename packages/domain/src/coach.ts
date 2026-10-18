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
  inviteLimit: 'coach.inviteLimit',
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
 * Coach mode goes off only once no player is linked (R-100). Switching it
 * off always revokes the coach's open invites (those whose `inviteState`
 * is `active`) and keeps the groups (R-109); the repository does both in
 * the same transaction.
 */
export function canStopCoaching(linkCount: number): CoachResult {
  return linkCount === 0 ? OK : refuse(COACH_REFUSALS.stillLinked);
}

/** What adding a player to a group depends on, loaded by the caller. */
export interface MembershipFacts {
  /** Is the group one of the coach's own? */
  readonly ownsGroup: boolean;
  /** Is the player linked to the coach now? */
  readonly linked: boolean;
}

/** A coach puts only a linked player, and only into an own group (R-12). */
export function canAddMember(facts: MembershipFacts): CoachResult {
  if (!facts.ownsGroup) return refuse(COACH_REFUSALS.groupNotFound);
  return facts.linked ? OK : refuse(COACH_REFUSALS.notLinked);
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

/**
 * The most open invites a coach may have (R-114); open is what
 * `inviteState` calls active: not revoked, not used, not expired. The
 * ruling sets it for every coach, not per entitlement.
 */
export const OPEN_INVITE_LIMIT = 50;

/**
 * Only a coach issues invites (R-12), and only while fewer than
 * OPEN_INVITE_LIMIT of the coach's invites are open (R-114).
 */
export function canInvite(coach: CoachState, openInvites: number): CoachResult {
  if (!isCoach(coach)) return refuse(COACH_REFUSALS.notCoach);
  return openInvites < OPEN_INVITE_LIMIT
    ? OK
    : refuse(COACH_REFUSALS.inviteLimit);
}

/**
 * While Coach mode is off the coach's groups are read-only (R-113):
 * renaming, deleting and changing members wait until it is on again.
 */
export function canChangeGroups(coach: CoachState): CoachResult {
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
