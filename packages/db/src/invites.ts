import {
  acceptedBy,
  canAccept,
  canInvite,
  canRevoke,
  COACH_REFUSALS,
  INVITE_REFUSALS,
  inviteExpiry,
  inviteSchema,
  ok,
  refuse,
  type CoachRefusal,
  type CoachState,
  type Invite,
  type InviteKind,
  type InviteRefusal,
  type InvitingCoach,
  type NewInvite,
  type Result,
  type ServedFacts,
} from '@mychess/domain';
import { and, desc, eq, gt, isNull, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { findAccountById, lockAccountById } from './accounts';
import { changeAssignments } from './assignments/change';
import type { Db, Executor, Tx } from './client';
import {
  countSchema,
  holdGroup,
  isLinked,
  isMember,
  linkCount,
} from './coach-queries';
import { isUuid } from './ids';
import {
  inviteTokenHash,
  newInviteToken,
  parsedTokenHash,
} from './invite-token';
import { coachLinks, groupMembers, groups, invites } from './schema';

const inviteColumns = {
  id: invites.id,
  coachId: invites.coachId,
  kind: invites.kind,
  groupId: invites.groupId,
  expiresAt: invites.expiresAt,
  revokedAt: invites.revokedAt,
  usedAt: invites.usedAt,
  createdAt: invites.createdAt,
};

const namedInviteSchema = inviteSchema.extend({
  groupName: z.string().nullable(),
});
/** An invite with its group's name. */
export type NamedInvite = z.infer<typeof namedInviteSchema>;

const namedInviteColumns = { ...inviteColumns, groupName: groups.name };

const INVALID = refuse(INVITE_REFUSALS.invalid);

/** A coach's parsed request for an invite (newInviteSchema), and when. */
export interface InviteRequest extends NewInvite {
  /** The session account, never a client value (checklist 4). */
  readonly coachId: string;
  readonly now: Date;
}

export interface CreatedInvite {
  /** The raw token, for the link; shown once and never stored. */
  readonly token: string;
  readonly inviteId: string;
}

/**
 * Open at `now`: what `inviteState` calls active, that is not revoked, not
 * used (only a personal invite is ever used, invites_used_personal) and
 * not yet expired.
 */
const openAt = (now: Date): SQL =>
  sql`(${isNull(invites.revokedAt)} and ${isNull(invites.usedAt)} and ${gt(invites.expiresAt, now)})`;

/** The coach's open invites at `now`. */
const openInvitesOf = (coachId: string, now: Date) =>
  and(eq(invites.coachId, coachId), openAt(now));

/**
 * How many open invites `coachId` has at `now` (R-114). Exported for the
 * test that ties openInvitesOf to the domain's inviteState.
 */
export async function openInviteCount(
  db: Executor,
  coachId: string,
  now: Date,
): Promise<number> {
  return countSchema.parse(
    await db.$count(invites, openInvitesOf(coachId, now)),
  );
}

/**
 * canInvite on the coach's open invites at `now` (R-114). The caller has
 * locked the coach row, so two creations at the limit cannot both pass.
 * Package-internal: createInvite and createGroup decide with it.
 */
export async function inviteAllowed(
  tx: Tx,
  coach: CoachState,
  coachId: string,
  now: Date,
): Promise<Result<undefined, CoachRefusal>> {
  return canInvite(coach, await openInviteCount(tx, coachId, now));
}

/**
 * May the coach make this invite? Locks the coach row (plan decision 1)
 * before counting the open invites, so two creations at the limit cannot
 * both pass (R-114), and holds the group row, so neither changes before
 * the invite is in.
 */
async function mayInvite(
  tx: Tx,
  request: InviteRequest,
): Promise<Result<undefined, CoachRefusal>> {
  const coach = await lockAccountById(tx, request.coachId);
  if (coach === undefined) return refuse(COACH_REFUSALS.notCoach);
  const allowed = await inviteAllowed(tx, coach, request.coachId, request.now);
  if (!allowed.ok || request.groupId === null) return allowed;
  return (await holdGroup(tx, request.coachId, request.groupId))
    ? allowed
    : refuse(COACH_REFUSALS.groupNotFound);
}

/**
 * Writes an invite the caller has already allowed (canInvite, under the
 * coach row's lock) and returns its raw token once; only its hash is
 * stored. Package-internal.
 */
export async function writeInvite(
  tx: Tx,
  request: InviteRequest,
): Promise<CreatedInvite> {
  const token = newInviteToken();
  const [row] = await tx
    .insert(invites)
    .values({
      coachId: request.coachId,
      kind: request.kind,
      groupId: request.groupId,
      tokenHash: inviteTokenHash(token),
      expiresAt: inviteExpiry(request.now),
      createdAt: request.now,
    })
    .returning({ id: invites.id });
  return { token, inviteId: z.uuid().parse(row?.id) };
}

/** Makes an invite; the raw token is returned here once and never stored. */
export function createInvite(
  db: Db,
  request: InviteRequest,
): Promise<Result<CreatedInvite, CoachRefusal>> {
  return db.transaction(async (tx) => {
    const allowed = await mayInvite(tx, request);
    if (!allowed.ok) return allowed;
    return ok(await writeInvite(tx, request));
  });
}

const coachIdSchema = z.object({ coachId: z.string().min(1) });

/** The coach of the invite with this hash, read without a lock. */
async function inviteCoachId(
  db: Executor,
  tokenHash: string,
): Promise<string | undefined> {
  const [row] = await db
    .select({ coachId: invites.coachId })
    .from(invites)
    .where(eq(invites.tokenHash, tokenHash))
    .limit(1);
  return row === undefined ? undefined : coachIdSchema.parse(row).coachId;
}

/**
 * The invite with this hash, locked for the rest of `tx` (single use), if
 * it is still `coachId`'s: the coach whose row `tx` already holds.
 */
async function lockInvite(
  tx: Tx,
  tokenHash: string,
  coachId: string,
): Promise<Invite | undefined> {
  const [row] = await tx
    .select(inviteColumns)
    .from(invites)
    .where(and(eq(invites.tokenHash, tokenHash), eq(invites.coachId, coachId)))
    .for('update');
  return row === undefined ? undefined : inviteSchema.parse(row);
}

/** Who asks to accept, and when. */
interface Asker {
  readonly playerId: string;
  readonly now: Date;
}

/** canAccept on the coach's links as `db` sees them now. */
async function decide(
  db: Executor,
  invite: Invite,
  coach: InvitingCoach,
  { playerId, now }: Asker,
): Promise<Result<undefined, InviteRefusal>> {
  const counts = {
    linkedPlayers: await linkCount(db, coach.id),
    alreadyLinked: await isLinked(db, coach.id, playerId),
  };
  return canAccept(invite, { playerId, coach, counts }, now);
}

export interface AcceptedInvite {
  readonly coachId: string;
  readonly groupId: string | null;
}

/**
 * Accepts an invite as `playerId` (the session account, never a client
 * value): locks the coach, then the invite, then counts, so two accepts
 * can never exceed the player limit or use a personal invite twice (plan
 * decision 1). The coach is learnt from an unlocked read first; the locked
 * read takes the invite only if it is still that coach's, so the coach row
 * held is always the invite's coach's.
 *
 * Lock order everywhere: the coach's account row, then that coach's invite
 * rows (createInvite, stopCoaching, deleteGroup do the same). Every
 * transaction that locks a coach's invites holds the coach row first, so
 * two of them queue on the coach row and none waits for the coach row
 * while holding an invite: no deadlock.
 *
 * `token` is the raw token the link carries; a malformed one is refused
 * without a lookup.
 */
export function acceptInvite(
  db: Db,
  token: string,
  playerId: string,
  now: Date,
): Promise<Result<AcceptedInvite, InviteRefusal>> {
  const tokenHash = parsedTokenHash(token);
  if (tokenHash === undefined) return Promise.resolve(INVALID);
  return db.transaction(async (tx) => {
    const coachId = await inviteCoachId(tx, tokenHash);
    if (coachId === undefined) return INVALID;
    const coach = await lockAccountById(tx, coachId);
    if (coach === undefined) return INVALID;
    const invite = await lockInvite(tx, tokenHash, coachId);
    if (invite === undefined) return INVALID;
    const check = await decide(tx, invite, coach, { playerId, now });
    if (!check.ok) return check;
    await join(tx, invite, playerId, now);
    return ok({ coachId: invite.coachId, groupId: invite.groupId });
  });
}

/**
 * The link (unless there is one), the membership and the use, as accepted.
 * The membership gives the player the group's assignments (R-16), closing
 * any open fork offer for them (lead decision 4).
 */
async function join(
  tx: Tx,
  invite: Invite,
  playerId: string,
  now: Date,
): Promise<void> {
  const { coachId, groupId } = invite;
  await tx
    .insert(coachLinks)
    .values({ coachId, playerId, createdAt: now })
    .onConflictDoNothing();
  // Only gains happen here, so the reason is never stored.
  if (groupId !== null)
    await changeAssignments(
      tx,
      { coachId, playerIds: [playerId], reason: 'leftGroup', now },
      () =>
        tx
          .insert(groupMembers)
          .values({ groupId, coachId, playerId, joinedAt: now })
          .onConflictDoNothing(),
    );
  if (invite.kind === 'personal')
    await tx
      .update(invites)
      .set({ usedAt: now, usedBy: playerId })
      .where(eq(invites.id, invite.id));
}

/**
 * Revokes the coach's open invites at `now` (R-109). The caller holds the
 * coach row (the lock order acceptInvite documents), so no invite of the
 * coach is made or accepted until `tx` ends.
 */
export async function revokeOpenInvites(
  tx: Tx,
  coachId: string,
  now: Date,
): Promise<void> {
  await tx
    .update(invites)
    .set({ revokedAt: now })
    .where(openInvitesOf(coachId, now));
}

/**
 * Revokes the coach's own invite while it is open: the domain's canRevoke
 * decides on the locked row, and the UPDATE is restricted to open invites
 * again. A used, expired, revoked or someone else's invite is "not valid"
 * and stays as it is.
 */
export async function revokeInvite(
  db: Executor,
  coachId: string,
  inviteId: string,
  now: Date,
): Promise<Result<undefined, InviteRefusal>> {
  if (!isUuid(inviteId)) return INVALID;
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select(inviteColumns)
      .from(invites)
      .where(and(eq(invites.id, inviteId), eq(invites.coachId, coachId)))
      .for('update');
    if (row === undefined || !canRevoke(inviteSchema.parse(row), now))
      return INVALID;
    const revoked = await tx
      .update(invites)
      .set({ revokedAt: now })
      .where(and(eq(invites.id, inviteId), openInvitesOf(coachId, now)))
      .returning({ id: invites.id });
    return revoked.length === 1 ? ok() : INVALID;
  });
}

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

/**
 * What the invite page shows: an invite the player may accept now
 * (`active`), or one that already serves them (`accepted`, #329), so a
 * second visit confirms instead of offering it again.
 */
export type InvitePreview =
  | {
      readonly state: 'active';
      readonly coachDisplayName: string;
      readonly groupName: string | null;
      readonly kind: InviteKind;
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
 * What accepting would do, without locks or changes: `accepted` when the
 * invite already serves the player (acceptedBy, whatever its state now);
 * otherwise the coach and the group on success, or the refusal accepting
 * would give now, as before #329, so no one else learns anything new.
 * `token` is the raw token the link carries; a malformed one is refused
 * without a lookup. SECURITY.
 */
export async function previewInvite(
  db: Executor,
  token: string,
  playerId: string,
  now: Date,
): Promise<Result<InvitePreview, InviteRefusal>> {
  const tokenHash = parsedTokenHash(token);
  if (tokenHash === undefined) return INVALID;
  const invite = await findPreviewedInvite(db, tokenHash);
  if (invite === undefined) return INVALID;
  const coach = await findAccountById(db, invite.coachId);
  if (coach === undefined) return INVALID;
  const shown = {
    coachDisplayName: coach.displayName,
    groupName: invite.groupName,
  };
  if (acceptedBy(invite, playerId, await servedFacts(db, invite, playerId)))
    return ok({ state: 'accepted', ...shown });
  const check = await decide(db, invite, coach, { playerId, now });
  if (!check.ok) return check;
  return ok({ state: 'active', ...shown, kind: invite.kind });
}

/** The invites `where` picks, with their groups' names, to order and limit. */
const namedInviteQuery = (db: Executor, where: SQL | undefined) =>
  db
    .select(namedInviteColumns)
    .from(invites)
    .leftJoin(groups, eq(groups.id, invites.groupId))
    .where(where)
    .$dynamic();

const namedInvitesSchema = z.array(namedInviteSchema);

/** Every invite the coach made, oldest first, for the export (R-106). */
export async function allCoachInvites(
  db: Executor,
  coachId: string,
): Promise<NamedInvite[]> {
  return namedInvitesSchema.parse(
    await namedInviteQuery(db, eq(invites.coachId, coachId)).orderBy(
      invites.createdAt,
      invites.id,
    ),
  );
}

/** One open invite on the coach's list; never a token or its hash. */
export interface CoachInvite {
  readonly id: string;
  readonly kind: InviteKind;
  /** The group a group invite joins; null for a personal invite. */
  readonly groupId: string | null;
  readonly groupName: string | null;
  readonly expiresAt: Date;
  readonly createdAt: Date;
}

/**
 * The coach's open invites at `now` (inviteState active: not revoked, not
 * used, not expired), newest first, so expired ones no longer pile up on
 * the dashboard (#329). None is capped: R-114 holds them to 50, and the
 * coach must see each one to revoke it. Closed invites stay in the data
 * export (allCoachInvites, R-106).
 */
export async function coachInvites(
  db: Executor,
  coachId: string,
  now: Date,
): Promise<CoachInvite[]> {
  const open = namedInvitesSchema.parse(
    await namedInviteQuery(db, openInvitesOf(coachId, now)).orderBy(
      desc(invites.createdAt),
      desc(invites.id),
    ),
  );
  return open.map((row) => ({
    id: row.id,
    kind: row.kind,
    groupId: row.groupId,
    groupName: row.groupName,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  }));
}

/** A group's open invite as its page shows it; never a token or its hash. */
export interface OpenGroupInvite {
  readonly id: string;
  readonly expiresAt: Date;
}

const openGroupInviteSchema = z.object({ id: z.uuid(), expiresAt: z.date() });

/**
 * The newest open invite at `now` of the coach's group (R-232), or
 * undefined: none open, another coach's group, or a malformed id. Reads
 * only the id and expiry; the token is never stored and its hash never
 * selected.
 */
export async function openGroupInvite(
  db: Executor,
  coachId: string,
  groupId: string,
  now: Date,
): Promise<OpenGroupInvite | undefined> {
  if (!isUuid(groupId)) return undefined;
  const [row] = await db
    .select({ id: invites.id, expiresAt: invites.expiresAt })
    .from(invites)
    .where(and(openInvitesOf(coachId, now), eq(invites.groupId, groupId)))
    .orderBy(desc(invites.createdAt), desc(invites.id))
    .limit(1);
  return row === undefined ? undefined : openGroupInviteSchema.parse(row);
}
