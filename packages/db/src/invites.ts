import {
  canAccept,
  canRevoke,
  canInvite,
  COACH_REFUSALS,
  INVITE_REFUSALS,
  inviteExpiry,
  inviteSchema,
  inviteState,
  type CoachRefusal,
  type Invite,
  type InviteKind,
  type InviteRefusal,
  type InviteState,
  type InvitingCoach,
  type NewInvite,
  type Result,
} from '@mychess/domain';
import { and, desc, eq, gt, isNull, not, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { findAccountById, lockAccountById } from './accounts';
import { changeAssignments } from './assignments/change';
import type { Db, Executor, Tx } from './client';
import { countSchema, holdGroup, isLinked, linkCount } from './coach-queries';
import { isUuid } from './ids';
import { inviteTokenHash, newInviteToken } from './invite-token';
import { DONE, refusal } from './results';
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

const INVALID = refusal(INVITE_REFUSALS.invalid);

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
 * not yet expired. Never null (expires_at is not null), so `not` of it is
 * exactly the closed invites.
 */
const openAt = (now: Date): SQL =>
  sql`(${isNull(invites.revokedAt)} and ${isNull(invites.usedAt)} and ${gt(invites.expiresAt, now)})`;

/** The coach's open invites at `now`. */
const openInvitesOf = (coachId: string, now: Date) =>
  and(eq(invites.coachId, coachId), openAt(now));

/** The coach's closed invites at `now`: revoked, used or expired. */
const closedInvitesOf = (coachId: string, now: Date) =>
  and(eq(invites.coachId, coachId), not(openAt(now)));

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
  if (coach === undefined) return refusal(COACH_REFUSALS.notCoach);
  const allowed = canInvite(
    coach,
    await openInviteCount(tx, request.coachId, request.now),
  );
  if (!allowed.ok || request.groupId === null) return allowed;
  return (await holdGroup(tx, request.coachId, request.groupId))
    ? allowed
    : refusal(COACH_REFUSALS.groupNotFound);
}

/** Makes an invite; the raw token is returned here once and never stored. */
export function createInvite(
  db: Db,
  request: InviteRequest,
): Promise<Result<CreatedInvite, CoachRefusal>> {
  return db.transaction(async (tx) => {
    const allowed = await mayInvite(tx, request);
    if (!allowed.ok) return allowed;
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
    return { ok: true, value: { token, inviteId: z.uuid().parse(row?.id) } };
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
 */
export function acceptInvite(
  db: Db,
  tokenHash: string,
  playerId: string,
  now: Date,
): Promise<Result<AcceptedInvite, InviteRefusal>> {
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
    return {
      ok: true,
      value: { coachId: invite.coachId, groupId: invite.groupId },
    };
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
    return revoked.length === 1 ? DONE : INVALID;
  });
}

/** The invite with this hash and its group's name, unlocked. */
async function findNamedInvite(
  db: Executor,
  tokenHash: string,
): Promise<NamedInvite | undefined> {
  const [row] = await db
    .select(namedInviteColumns)
    .from(invites)
    .leftJoin(groups, eq(groups.id, invites.groupId))
    .where(eq(invites.tokenHash, tokenHash))
    .limit(1);
  return row === undefined ? undefined : namedInviteSchema.parse(row);
}

/** What the invite page shows before the player accepts. */
export interface InvitePreview {
  readonly coachDisplayName: string;
  readonly groupName: string | null;
  readonly kind: InviteKind;
}

/**
 * What accepting would do, without locks or changes: the coach and the
 * group on success, or the refusal accepting would give now.
 */
export async function previewInvite(
  db: Executor,
  tokenHash: string,
  playerId: string,
  now: Date,
): Promise<Result<InvitePreview, InviteRefusal>> {
  const invite = await findNamedInvite(db, tokenHash);
  if (invite === undefined) return INVALID;
  const coach = await findAccountById(db, invite.coachId);
  if (coach === undefined) return INVALID;
  const check = await decide(db, invite, coach, { playerId, now });
  if (!check.ok) return check;
  return {
    ok: true,
    value: {
      coachDisplayName: coach.displayName,
      groupName: invite.groupName,
      kind: invite.kind,
    },
  };
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

/** One row of the coach's invite list; never a token or its hash. */
export interface CoachInvite {
  readonly id: string;
  readonly kind: InviteKind;
  readonly groupName: string | null;
  readonly state: InviteState;
  readonly expiresAt: Date;
  readonly createdAt: Date;
}

/**
 * The most closed (revoked, used or expired) invites the list shows. Open
 * invites are never capped here: R-114 already holds them to 50, and the
 * coach must see each one to revoke it.
 */
const CLOSED_INVITE_LIST_MAX = 50;

const newestFirst = (a: NamedInvite, b: NamedInvite): number =>
  b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1);

/**
 * The coach's invites, newest first, with their state at `now`: every open
 * one, and the newest closed ones up to CLOSED_INVITE_LIST_MAX.
 */
export async function coachInvites(
  db: Executor,
  coachId: string,
  now: Date,
): Promise<CoachInvite[]> {
  const open = namedInvitesSchema.parse(
    await namedInviteQuery(db, openInvitesOf(coachId, now)),
  );
  const closed = namedInvitesSchema.parse(
    await namedInviteQuery(db, closedInvitesOf(coachId, now))
      .orderBy(desc(invites.createdAt), desc(invites.id))
      .limit(CLOSED_INVITE_LIST_MAX),
  );
  return [...open, ...closed].sort(newestFirst).map((row) => ({
    id: row.id,
    kind: row.kind,
    groupName: row.groupName,
    state: inviteState(row, now),
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  }));
}
