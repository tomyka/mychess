import { ok, refuse, type Result } from '@mychess/chess';
import { z } from 'zod';
import { entitlementLimits, type Account } from './account';
import { isDisabled } from './account-lifecycle';
import { isCoach, type CoachFacts } from './coach';

/** A personal invite is single use; a group invite is multi-use (R-98). */
export const INVITE_KINDS = ['personal', 'group'] as const;
export type InviteKind = (typeof INVITE_KINDS)[number];

export const INVITE_STATES = ['active', 'expired', 'used', 'revoked'] as const;
export type InviteState = (typeof INVITE_STATES)[number];

/** An invite is valid for 7 days (R-99). */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Message-catalogue keys for invite refusals. Expired, used, revoked and
 * unknown tokens, and invites from a disabled coach (R-108) or from one out
 * of Coach mode, all give `invalid`, so a refusal reveals nothing more.
 */
export const INVITE_REFUSALS = {
  invalid: 'invite.invalid',
  ownInvite: 'invite.ownInvite',
  coachFull: 'invite.coachFull',
} as const;

export interface InviteRefusal {
  readonly reason: (typeof INVITE_REFUSALS)[keyof typeof INVITE_REFUSALS];
}

/** Message-catalogue keys for a new invite's form issues (R-110). */
export const INVITE_ISSUES = {
  kindInvalid: 'invite.kindInvalid',
  groupRequired: 'invite.groupRequired',
  groupInvalid: 'invite.groupInvalid',
} as const;

/** One invite as the database hands it over (parsed at the edge); never its token. */
export const inviteSchema = z.object({
  id: z.uuid(),
  coachId: z.string().min(1),
  kind: z.enum(INVITE_KINDS),
  groupId: z.uuid().nullable(),
  expiresAt: z.date(),
  revokedAt: z.date().nullable(),
  usedAt: z.date().nullable(),
  createdAt: z.date(),
});
export type Invite = z.infer<typeof inviteSchema>;

/**
 * What a coach asks for when creating an invite (R-110): a personal invite
 * may name a group, a group invite always names one. A missing group reads
 * as none. Whether the group is the coach's own is the repository's check.
 */
export const newInviteSchema = z
  .object({
    kind: z.enum(INVITE_KINDS, INVITE_ISSUES.kindInvalid),
    groupId: z.uuid(INVITE_ISSUES.groupInvalid).nullable().default(null),
  })
  .refine((invite) => invite.kind === 'personal' || invite.groupId !== null, {
    message: INVITE_ISSUES.groupRequired,
    path: ['groupId'],
  });
export type NewInvite = z.infer<typeof newInviteSchema>;

/** An invite link's token: 32 random bytes, base64url (checklist 5). */
export const inviteTokenSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/, INVITE_REFUSALS.invalid);

/** When an invite created at `createdAt` stops being valid (R-99). */
export function inviteExpiry(createdAt: Date): Date {
  return new Date(createdAt.getTime() + INVITE_TTL_MS);
}

/**
 * Revoked beats used beats expired; a group invite is never "used".
 * packages/db's `openAt` (invites.ts) restates "active" in SQL: a new
 * state, or a change to what makes one, is changed in both.
 */
export function inviteState(invite: Invite, now: Date): InviteState {
  if (invite.revokedAt !== null) return 'revoked';
  if (invite.kind === 'personal' && invite.usedAt !== null) return 'used';
  return now.getTime() < invite.expiresAt.getTime() ? 'active' : 'expired';
}

/**
 * May the coach revoke `invite` now? Only an open (active) one: a used,
 * expired or already revoked invite stays as it is.
 */
export function canRevoke(invite: Invite, now: Date): boolean {
  return inviteState(invite, now) === 'active';
}

/** What accepting needs to know about the coach behind the invite. */
export type InvitingCoach = CoachFacts & Pick<Account, 'id' | 'disabledAt'>;

/** The coach's links at the moment of accepting (read under lock). */
export interface AcceptCounts {
  readonly linkedPlayers: number;
  readonly alreadyLinked: boolean;
}

type AcceptResult = Result<undefined, InviteRefusal>;

/**
 * An invite is valid while active and while its coach is neither disabled
 * (R-108) nor out of Coach mode.
 */
const isValid = (invite: Invite, coach: InvitingCoach, now: Date): boolean =>
  inviteState(invite, now) === 'active' && !isDisabled(coach) && isCoach(coach);

/** An already linked player needs no new link, so the limit does not apply. */
const hasRoom = (coach: InvitingCoach, counts: AcceptCounts): boolean =>
  counts.alreadyLinked ||
  counts.linkedPlayers < entitlementLimits(coach.entitlement).coachPlayers;

/** Who accepts, and the coach behind the invite as read under lock. */
export interface Acceptance {
  /** The session account, never a client value (checklist 4). */
  readonly playerId: string;
  /** The account behind `invite.coachId`. */
  readonly coach: InvitingCoach;
  readonly counts: AcceptCounts;
}

/** May the player accept `invite` now (R-12, R-70, R-98, R-99, R-108)? */
export function canAccept(
  invite: Invite,
  { playerId, coach, counts }: Acceptance,
  now: Date,
): AcceptResult {
  if (!isValid(invite, coach, now)) return refuse(INVITE_REFUSALS.invalid);
  if (playerId === invite.coachId) return refuse(INVITE_REFUSALS.ownInvite);
  return hasRoom(coach, counts) ? ok() : refuse(INVITE_REFUSALS.coachFull);
}
