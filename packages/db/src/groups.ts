import {
  canAddMember,
  canChangeGroups,
  canCreateGroup,
  COACH_REFUSALS,
  type CoachRefusal,
  type Result,
} from '@mychess/domain';
import { and, count, eq } from 'drizzle-orm';
import { z } from 'zod';
import { lockAccountById } from './accounts';
import type { Db, Executor, Tx } from './client';
import { groupCount, holdGroup, holdLink, isUuid } from './coach-queries';
import { DONE, refusal } from './results';
import { accounts, groupMembers, groups } from './schema';

type GroupResult = Result<undefined, CoachRefusal>;

const GROUP_NOT_FOUND = refusal(COACH_REFUSALS.groupNotFound);
const NOT_COACH = refusal(COACH_REFUSALS.notCoach);

/**
 * May the coach change its groups now? Locks the coach row first, the lock
 * order acceptInvite documents, so Coach mode cannot go off (stopCoaching
 * locks the same row) until `tx` ends; while it is off the groups are
 * read-only (R-113).
 */
async function mayChangeGroups(tx: Tx, coachId: string): Promise<GroupResult> {
  const coach = await lockAccountById(tx, coachId);
  return coach === undefined ? NOT_COACH : canChangeGroups(coach);
}

const groupIs = (coachId: string, groupId: string) =>
  and(eq(groups.id, groupId), eq(groups.coachId, coachId));

/**
 * Makes a group of the coach and returns its id, within the entitlement's
 * limit (R-70). `name` is already parsed (groupNameSchema); the CHECK is
 * the backstop. Locks the coach row first (plan decision 1), so two
 * creations at the limit cannot both pass.
 */
export function createGroup(
  db: Db,
  coachId: string,
  name: string,
  now: Date,
): Promise<Result<string, CoachRefusal>> {
  return db.transaction(async (tx) => {
    const coach = await lockAccountById(tx, coachId);
    if (coach === undefined) return NOT_COACH;
    const allowed = canCreateGroup(coach, await groupCount(tx, coachId));
    if (!allowed.ok) return allowed;
    const [row] = await tx
      .insert(groups)
      .values({ coachId, name, createdAt: now })
      .returning({ id: groups.id });
    return { ok: true, value: z.uuid().parse(row?.id) };
  });
}

/**
 * Renames the coach's own group while Coach mode is on (R-113); any other
 * group is not found.
 */
export function renameGroup(
  db: Db,
  coachId: string,
  groupId: string,
  name: string,
): Promise<GroupResult> {
  if (!isUuid(groupId)) return Promise.resolve(GROUP_NOT_FOUND);
  return db.transaction(async (tx) => {
    const allowed = await mayChangeGroups(tx, coachId);
    if (!allowed.ok) return allowed;
    const renamed = await tx
      .update(groups)
      .set({ name })
      .where(groupIs(coachId, groupId))
      .returning({ id: groups.id });
    return renamed.length === 1 ? DONE : GROUP_NOT_FOUND;
  });
}

/**
 * Deletes the coach's own group while Coach mode is on (R-113); its
 * memberships and invites go with it (cascade). Locks the coach row
 * first, the lock order acceptInvite documents: an accept of one of the group's invites holds the invite and
 * then wants the group, so deleting the group (which then wants the
 * invite) without the coach row first could deadlock with it.
 */
export function deleteGroup(
  db: Db,
  coachId: string,
  groupId: string,
): Promise<GroupResult> {
  if (!isUuid(groupId)) return Promise.resolve(GROUP_NOT_FOUND);
  return db.transaction(async (tx) => {
    const allowed = await mayChangeGroups(tx, coachId);
    if (!allowed.ok) return allowed;
    const deleted = await tx
      .delete(groups)
      .where(groupIs(coachId, groupId))
      .returning({ id: groups.id });
    return deleted.length === 1 ? DONE : GROUP_NOT_FOUND;
  });
}

/** A player in a coach's group; `coachId` is the session account. */
export interface Membership {
  readonly coachId: string;
  readonly groupId: string;
  readonly playerId: string;
}

/**
 * Puts a linked player into the coach's own group (R-12) while Coach mode
 * is on (R-113). The coach row is locked first, then the group and the
 * link are held, so a deleteGroup or an unlink waits for this insert
 * and then removes it too.
 */
export function addMember(
  db: Db,
  { coachId, groupId, playerId }: Membership,
  now: Date,
): Promise<GroupResult> {
  return db.transaction(async (tx) => {
    const coaching = await mayChangeGroups(tx, coachId);
    if (!coaching.ok) return coaching;
    const allowed = canAddMember({
      ownsGroup: await holdGroup(tx, coachId, groupId),
      linked: await holdLink(tx, coachId, playerId),
    });
    if (!allowed.ok) return allowed;
    await tx
      .insert(groupMembers)
      .values({ groupId, coachId, playerId, joinedAt: now })
      .onConflictDoNothing();
    return allowed;
  });
}

/**
 * Takes a player out of the coach's own group while Coach mode is on
 * (R-113); the link stays. Like adding twice, removing a player who is not
 * in the group changes nothing.
 */
export function removeMember(
  db: Db,
  { coachId, groupId, playerId }: Membership,
): Promise<GroupResult> {
  return db.transaction(async (tx) => {
    const allowed = await mayChangeGroups(tx, coachId);
    if (!allowed.ok) return allowed;
    if (!(await holdGroup(tx, coachId, groupId))) return GROUP_NOT_FOUND;
    await tx
      .delete(groupMembers)
      .where(
        and(
          eq(groupMembers.groupId, groupId),
          eq(groupMembers.playerId, playerId),
        ),
      );
    return DONE;
  });
}

/**
 * The player leaves a group and stays linked to its coach (R-45), whether
 * or not the coach is in Coach mode (R-113 binds only the coach). A group
 * the player is not in is not found.
 */
export async function leaveGroup(
  db: Executor,
  playerId: string,
  groupId: string,
): Promise<GroupResult> {
  if (!isUuid(groupId)) return GROUP_NOT_FOUND;
  const left = await db
    .delete(groupMembers)
    .where(
      and(
        eq(groupMembers.groupId, groupId),
        eq(groupMembers.playerId, playerId),
      ),
    )
    .returning({ playerId: groupMembers.playerId });
  return left.length === 1 ? DONE : GROUP_NOT_FOUND;
}

/** One row of the coach's group list. */
export interface CoachGroupSummary {
  readonly id: string;
  readonly name: string;
  readonly memberCount: number;
  readonly createdAt: Date;
}

const summaryRowsSchema = z.array(
  z.object({
    id: z.uuid(),
    name: z.string(),
    memberCount: z.number().int().nonnegative(),
    createdAt: z.date(),
  }),
);

/** The coach's groups by name, with how many players each holds. */
export async function coachGroups(
  db: Executor,
  coachId: string,
): Promise<CoachGroupSummary[]> {
  return summaryRowsSchema.parse(
    await db
      .select({
        id: groups.id,
        name: groups.name,
        memberCount: count(groupMembers.playerId),
        createdAt: groups.createdAt,
      })
      .from(groups)
      .leftJoin(groupMembers, eq(groupMembers.groupId, groups.id))
      .where(eq(groups.coachId, coachId))
      .groupBy(groups.id)
      .orderBy(groups.name, groups.id),
  );
}

/** A member of a group, as its coach sees them. */
export interface GroupMember {
  readonly id: string;
  readonly displayName: string;
  readonly joinedAt: Date;
}

/** One group of the coach, with its members. */
export interface CoachGroup {
  readonly id: string;
  readonly name: string;
  readonly createdAt: Date;
  readonly members: readonly GroupMember[];
}

const groupRowSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  createdAt: z.date(),
});

const memberRowsSchema = z.array(
  z.object({
    id: z.string().min(1),
    displayName: z.string(),
    joinedAt: z.date(),
  }),
);

/** The coach's own group with its members by name; undefined otherwise. */
export async function coachGroup(
  db: Executor,
  coachId: string,
  groupId: string,
): Promise<CoachGroup | undefined> {
  if (!isUuid(groupId)) return undefined;
  const [row] = await db
    .select({ id: groups.id, name: groups.name, createdAt: groups.createdAt })
    .from(groups)
    .where(groupIs(coachId, groupId))
    .limit(1);
  if (row === undefined) return undefined;
  const members = memberRowsSchema.parse(
    await db
      .select({
        id: accounts.id,
        displayName: accounts.displayName,
        joinedAt: groupMembers.joinedAt,
      })
      .from(groupMembers)
      .innerJoin(accounts, eq(accounts.id, groupMembers.playerId))
      .where(
        and(
          eq(groupMembers.groupId, groupId),
          eq(groupMembers.coachId, coachId),
        ),
      )
      .orderBy(accounts.displayName, accounts.id),
  );
  return { ...groupRowSchema.parse(row), members };
}
