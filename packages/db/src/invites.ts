import {
  canAccept,
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
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { findAccountById, lockAccountById } from './accounts';
import type { Db, Executor, Tx } from './client';
import { holdGroup, isLinked, isUuid, linkCount } from './coach-queries';
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
 * May the coach make this invite? Locks the coach row (plan decision 1)
 * and holds the group row, so neither changes before the invite is in.
 */
async function mayInvite(
  tx: Tx,
  request: InviteRequest,
): Promise<Result<undefined, CoachRefusal>> {
  const coach = await lockAccountById(tx, request.coachId);
  if (coach === undefined) return refusal(COACH_REFUSALS.notCoach);
  const allowed = canInvite(coach);
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

/** The link (unless there is one), the membership and the use, as accepted. */
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
  if (groupId !== null)
    await tx
      .insert(groupMembers)
      .values({ groupId, coachId, playerId, joinedAt: now })
      .onConflictDoNothing();
  if (invite.kind === 'personal')
    await tx
      .update(invites)
      .set({ usedAt: now, usedBy: playerId })
      .where(eq(invites.id, invite.id));
}

/**
 * Revokes the coach's open invites at `now` (R-109): those `inviteState`
 * calls active, that is not revoked, not used (only a personal invite is
 * ever used) and not expired. The caller holds the coach row (the lock
 * order acceptInvite documents), so no invite of the coach is made or
 * accepted until `tx` ends.
 */
export async function revokeOpenInvites(
  tx: Tx,
  coachId: string,
  now: Date,
): Promise<void> {
  await tx
    .update(invites)
    .set({ revokedAt: now })
    .where(
      and(
        eq(invites.coachId, coachId),
        isNull(invites.revokedAt),
        isNull(invites.usedAt),
        gt(invites.expiresAt, now),
      ),
    );
}

/** Revokes the coach's own invite; anything else is "not valid". */
export async function revokeInvite(
  db: Executor,
  coachId: string,
  inviteId: string,
  now: Date,
): Promise<Result<undefined, InviteRefusal>> {
  if (!isUuid(inviteId)) return INVALID;
  const revoked = await db
    .update(invites)
    .set({ revokedAt: now })
    .where(
      and(
        eq(invites.id, inviteId),
        eq(invites.coachId, coachId),
        isNull(invites.revokedAt),
      ),
    )
    .returning({ id: invites.id });
  return revoked.length === 1 ? DONE : INVALID;
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

/** The coach's invites with their groups' names, to order and limit. */
const coachInviteQuery = (db: Executor, coachId: string) =>
  db
    .select(namedInviteColumns)
    .from(invites)
    .leftJoin(groups, eq(groups.id, invites.groupId))
    .where(eq(invites.coachId, coachId))
    .$dynamic();

const namedInvitesSchema = z.array(namedInviteSchema);

/** Every invite the coach made, oldest first, for the export (R-106). */
export async function allCoachInvites(
  db: Executor,
  coachId: string,
): Promise<NamedInvite[]> {
  return namedInvitesSchema.parse(
    await coachInviteQuery(db, coachId).orderBy(invites.createdAt, invites.id),
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

/** The most invites the list shows. */
const INVITE_LIST_MAX = 50;

/** The coach's invites, newest first, with their state at `now`. */
export async function coachInvites(
  db: Executor,
  coachId: string,
  now: Date,
): Promise<CoachInvite[]> {
  const rows = namedInvitesSchema.parse(
    await coachInviteQuery(db, coachId)
      .orderBy(desc(invites.createdAt), desc(invites.id))
      .limit(INVITE_LIST_MAX),
  );
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    groupName: row.groupName,
    state: inviteState(row, now),
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  }));
}
