import {
  acceptedBy,
  isValidInvite,
  joinedGroupOf,
  ok,
  type Account,
  type InviteKind,
  type InviteRefusal,
  type Result,
  type ServedFacts,
} from '@mychess/domain';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { findAccountById } from './accounts';
import type { Executor } from './client';
import { isLinked, isMember } from './coach-queries';
import { assignmentsToGroup } from './groups';
import { parsedTokenHash } from './invite-token';
import {
  decide,
  INVALID,
  namedInviteColumns,
  namedInviteSchema,
} from './invites';
import { groups, invites } from './schema';

const previewedInviteSchema = namedInviteSchema.extend({
  usedBy: z.string().nullable(),
});
/** An invite as the invite page reads it: its group's name and who used it. */
type PreviewedInvite = z.infer<typeof previewedInviteSchema>;

/** The invite with this hash, its group's name and who used it, unlocked. */
async function findPreviewedInvite(
  db: Executor,
  tokenHash: string,
): Promise<PreviewedInvite | undefined> {
  const [row] = await db
    .select({ ...namedInviteColumns, usedBy: invites.usedBy })
    .from(invites)
    .leftJoin(groups, eq(groups.id, invites.groupId))
    .where(eq(invites.tokenHash, tokenHash))
    .limit(1);
  return row === undefined ? undefined : previewedInviteSchema.parse(row);
}

/** An invite and the account behind it, as a link's token finds them. */
interface FoundInvite {
  readonly invite: PreviewedInvite;
  readonly coach: Account;
}

/**
 * The invite `token` (the raw token a link carries) names and its coach,
 * unlocked; undefined for an unknown token or coach. A malformed token is
 * refused without a lookup, and the token is never logged.
 */
async function findInvite(
  db: Executor,
  token: string,
): Promise<FoundInvite | undefined> {
  const tokenHash = parsedTokenHash(token);
  if (tokenHash === undefined) return undefined;
  const invite = await findPreviewedInvite(db, tokenHash);
  if (invite === undefined) return undefined;
  const coach = await findAccountById(db, invite.coachId);
  return coach === undefined ? undefined : { invite, coach };
}

/** One repertoire an invite comes with: its name and deadline only (R-236). */
export interface InviteAssignment {
  readonly repertoireName: string;
  /** A calendar date (YYYY-MM-DD); null for none. */
  readonly deadline: string | null;
}

/**
 * What the invite page shows: an invite the player may accept now
 * (`active`), with what it comes with (R-236), or one that already serves
 * them (`accepted`, #329), so a second visit confirms instead of offering
 * it again.
 */
export type InvitePreview =
  | {
      readonly state: 'active';
      readonly coachDisplayName: string;
      readonly groupName: string | null;
      readonly kind: InviteKind;
      /** The current assignments of the group accepting joins; none for no group. */
      readonly assignments: readonly InviteAssignment[];
    }
  | {
      readonly state: 'accepted';
      readonly coachDisplayName: string;
      readonly groupName: string | null;
    };

/**
 * acceptedBy's facts for `playerId` on `invite`, both reads filtered by
 * that account: a link to its coach, and membership of its group.
 */
async function servedFacts(
  db: Executor,
  invite: PreviewedInvite,
  playerId: string,
): Promise<ServedFacts> {
  return {
    usedBy: invite.usedBy,
    linked: await isLinked(db, invite.coachId, playerId),
    member:
      invite.groupId !== null && (await isMember(db, invite.groupId, playerId)),
  };
}

/**
 * What an invite comes with (R-236): the assignments of the group
 * accepting it joins (joinedGroupOf), by repertoire name, read only once
 * accepting is allowed; none when it joins no group.
 */
async function comesWith(
  db: Executor,
  invite: PreviewedInvite,
): Promise<InviteAssignment[]> {
  const groupId = joinedGroupOf(invite);
  if (groupId === null) return [];
  const assigned = await assignmentsToGroup(db, invite.coachId, groupId);
  return assigned.map(({ repertoireName, deadline }) => ({
    repertoireName,
    deadline,
  }));
}

/**
 * What accepting would do, without locks or changes: `accepted` when the
 * invite already serves the player (acceptedBy, whatever its state now);
 * otherwise the coach, the group and what it comes with on success, or the
 * refusal accepting would give now, as before #329, so no one else learns
 * anything new. SECURITY.
 */
export async function previewInvite(
  db: Executor,
  token: string,
  playerId: string,
  now: Date,
): Promise<Result<InvitePreview, InviteRefusal>> {
  const found = await findInvite(db, token);
  if (found === undefined) return INVALID;
  const { invite, coach } = found;
  const shown = {
    coachDisplayName: coach.displayName,
    groupName: invite.groupName,
  };
  if (acceptedBy(invite, playerId, await servedFacts(db, invite, playerId)))
    return ok({ state: 'accepted', ...shown });
  const check = await decide(db, invite, coach, { playerId, now });
  if (!check.ok) return check;
  const assignments = await comesWith(db, invite);
  return ok({ state: 'active', ...shown, kind: invite.kind, assignments });
}

/** What an invite link may say to anyone holding it (R-235). */
export interface InviteTeaser {
  readonly coachDisplayName: string;
  readonly groupName: string | null;
}

/**
 * The coach's display name and the group's name of a valid invite
 * (isValidInvite), for a visitor who is not signed in (R-235); undefined
 * for anything else, so an invalid link names no one. Reads nothing about
 * the coach's players. SECURITY.
 */
export async function inviteTeaser(
  db: Executor,
  token: string,
  now: Date,
): Promise<InviteTeaser | undefined> {
  const found = await findInvite(db, token);
  if (found === undefined) return undefined;
  const { invite, coach } = found;
  if (!isValidInvite(invite, coach, now)) return undefined;
  return { coachDisplayName: coach.displayName, groupName: invite.groupName };
}
