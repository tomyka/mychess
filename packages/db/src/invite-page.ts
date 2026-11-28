import {
  acceptedBy,
  comesWithGroupOf,
  isValidInvite,
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

/** What an invite link may say to anyone holding it (R-235). */
export interface InviteTeaser {
  readonly coachDisplayName: string;
  readonly groupName: string | null;
}

/** The coach's display name and the group's name, as any invite read names them. */
const teaserOf = ({ invite, coach }: FoundInvite): InviteTeaser => ({
  coachDisplayName: coach.displayName,
  groupName: invite.groupName,
});

/**
 * What the invite page shows: the teaser of an invite the player may
 * accept now (`active`), with what it comes with (R-236), or of one that
 * already serves them (`accepted`, #329), so a second visit confirms
 * instead of offering it again.
 */
export type InvitePreview =
  | (InviteTeaser & {
      readonly state: 'active';
      readonly kind: InviteKind;
      /** The current assignments of the group accepting joins; none for no group. */
      readonly assignments: readonly InviteAssignment[];
    })
  | (InviteTeaser & { readonly state: 'accepted' });

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
 * What an invite comes with (R-236): the assignments, by repertoire name,
 * of the group comesWithGroupOf allows on `decision`; none otherwise.
 */
async function comesWith(
  db: Executor,
  invite: PreviewedInvite,
  decision: Result<undefined, InviteRefusal>,
): Promise<InviteAssignment[]> {
  const groupId = comesWithGroupOf(invite, decision);
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
  const teaser = teaserOf(found);
  if (acceptedBy(invite, playerId, await servedFacts(db, invite, playerId)))
    return ok({ state: 'accepted', ...teaser });
  const check = await decide(db, invite, coach, { playerId, now });
  if (!check.ok) return check;
  const assignments = await comesWith(db, invite, check);
  return ok({ state: 'active', ...teaser, kind: invite.kind, assignments });
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
  return isValidInvite(found.invite, found.coach, now)
    ? teaserOf(found)
    : undefined;
}
