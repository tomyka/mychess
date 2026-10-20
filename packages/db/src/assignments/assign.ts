/**
 * A coach assigns their own repertoire to a linked player or one of their
 * groups, ends an assignment and moves its deadline (R-15, R-16, R-51,
 * R-130). Every change of who has what runs through changeAssignments in
 * the same transaction (plan decision 5). Lock order, as in S4: the coach's
 * account row first, then the rest.
 */
import {
  ASSIGNMENT_REFUSALS,
  canAssign,
  type AssignmentRefusal,
  type AssignmentTarget,
  type Result,
} from '@mychess/domain';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { lockAccountById } from '../accounts';
import { assignmentPlayers, assignments } from '../assignment-schema';
import type { Db, Executor, Tx } from '../client';
import {
  countSchema,
  holdGroup,
  holdLink,
  playerRowsSchema,
} from '../coach-queries';
import { isUuid } from '../ids';
import { DONE, refusal } from '../results';
import { groupMembers, repertoires } from '../schema';
import { changeAssignments } from './change';

type AssignmentResult = Result<undefined, AssignmentRefusal>;

const NOT_FOUND = refusal(ASSIGNMENT_REFUSALS.notFound);

/** An assignment's target as its columns: exactly one is set. */
interface TargetColumns {
  readonly playerId: string | null;
  readonly groupId: string | null;
}

const targetColumns = (target: AssignmentTarget): TargetColumns =>
  target.kind === 'player'
    ? { playerId: target.playerId, groupId: null }
    : { playerId: null, groupId: target.groupId };

const targetRowSchema = z.object({
  id: z.uuid(),
  playerId: z.string().min(1).nullable(),
  groupId: z.uuid().nullable(),
});

/** Every player the rows reach: their own player, or their group's members. */
async function playersReached(
  tx: Tx,
  rows: readonly TargetColumns[],
): Promise<string[]> {
  const direct = rows.flatMap((row) =>
    row.playerId === null ? [] : [row.playerId],
  );
  const groupIds = rows.flatMap((row) =>
    row.groupId === null ? [] : [row.groupId],
  );
  if (groupIds.length === 0) return direct;
  const members = playerRowsSchema.parse(
    await tx
      .select({ playerId: groupMembers.playerId })
      .from(groupMembers)
      .where(inArray(groupMembers.groupId, groupIds)),
  );
  return [...direct, ...members.map((member) => member.playerId)];
}

const repertoireRowsSchema = z.array(
  z.object({ ownerId: z.string().min(1), version: z.number().int() }),
);

/**
 * The repertoire's owner and version, its row held (FOR KEY SHARE) for the
 * rest of `tx` so it cannot be deleted under the new assignment.
 */
async function holdRepertoire(
  tx: Tx,
  repertoireId: string,
): Promise<{ ownerId: string; version: number } | undefined> {
  if (!isUuid(repertoireId)) return undefined;
  const [row] = repertoireRowsSchema.parse(
    await tx
      .select({
        ownerId: repertoires.ownerAccountId,
        version: repertoires.version,
      })
      .from(repertoires)
      .where(eq(repertoires.id, repertoireId))
      .for('key share'),
  );
  return row;
}

/** Is the target a linked player or the coach's own group? Holds that row. */
const holdTarget = (
  tx: Tx,
  coachId: string,
  target: AssignmentTarget,
): Promise<boolean> =>
  target.kind === 'player'
    ? holdLink(tx, coachId, target.playerId)
    : holdGroup(tx, coachId, target.groupId);

/** Is the repertoire already assigned to this target? */
async function isAssigned(
  tx: Tx,
  repertoireId: string,
  target: AssignmentTarget,
): Promise<boolean> {
  const sameTarget =
    target.kind === 'player'
      ? eq(assignments.playerId, target.playerId)
      : eq(assignments.groupId, target.groupId);
  const rows = countSchema.parse(
    await tx.$count(
      assignments,
      and(eq(assignments.repertoireId, repertoireId), sameTarget),
    ),
  );
  return rows > 0;
}

/** A coach's parsed request to assign a repertoire. */
export interface AssignRequest {
  /** The session account, never a client value. */
  readonly coachId: string;
  readonly repertoireId: string;
  readonly target: AssignmentTarget;
  /** Already parsed by deadlineSchema; null for none. */
  readonly deadline: string | null;
}

/** canAssign on the facts read under the coach row's lock. */
async function decideAssign(
  tx: Tx,
  req: AssignRequest,
): Promise<Result<number, AssignmentRefusal>> {
  const coach = await lockAccountById(tx, req.coachId);
  const repertoire = await holdRepertoire(tx, req.repertoireId);
  const targetAllowed = await holdTarget(tx, req.coachId, req.target);
  const allowed = canAssign(req.coachId, req.target, {
    coachSince: coach?.coachSince ?? null,
    repertoireOwnerId: repertoire?.ownerId,
    targetAllowed,
    // Asked only once both ids are known to be well-formed and real.
    alreadyAssigned:
      repertoire !== undefined &&
      targetAllowed &&
      (await isAssigned(tx, req.repertoireId, req.target)),
  });
  if (!allowed.ok) return allowed;
  return repertoire === undefined
    ? NOT_FOUND
    : { ok: true, value: repertoire.version };
}

/**
 * R-128, plan decision 8: an assignment given again reaches a player who
 * forked the repertoire live again.
 */
async function clearForks(
  tx: Tx,
  playerIds: readonly string[],
  repertoireId: string,
): Promise<void> {
  if (playerIds.length === 0) return;
  await tx
    .update(assignmentPlayers)
    .set({ forkedAt: null })
    .where(
      and(
        eq(assignmentPlayers.repertoireId, repertoireId),
        inArray(assignmentPlayers.playerId, [...playerIds]),
      ),
    );
}

/**
 * Assigns the coach's own repertoire to a linked player or one of the
 * coach's groups (canAssign decides). Closes the open fork offers of the
 * players it gives the repertoire back to (lead decision 4).
 */
export function assign(
  db: Db,
  req: AssignRequest,
  now: Date,
): Promise<AssignmentResult> {
  return db.transaction(async (tx) => {
    const decided = await decideAssign(tx, req);
    if (!decided.ok) return decided;
    const columns = targetColumns(req.target);
    const players = await playersReached(tx, [columns]);
    await changeAssignments(
      tx,
      { coachId: req.coachId, playerIds: players, reason: 'unassigned', now },
      async () => {
        await tx.insert(assignments).values({
          ...columns,
          coachId: req.coachId,
          repertoireId: req.repertoireId,
          deadline: req.deadline,
          assignedVersion: decided.value,
          createdAt: now,
        });
        await clearForks(tx, players, req.repertoireId);
      },
    );
    return DONE;
  });
}

/** One of a coach's assignments; `coachId` is the session account. */
export interface AssignmentRef {
  readonly coachId: string;
  readonly assignmentId: string;
}

/**
 * Ends the coach's own assignment (R-130): each player who no longer has
 * the repertoire through any assignment gets a 30-day fork offer. Another
 * coach's assignment is not found and stays.
 */
export function unassign(
  db: Db,
  ref: AssignmentRef,
  now: Date,
): Promise<AssignmentResult> {
  if (!isUuid(ref.assignmentId)) return Promise.resolve(NOT_FOUND);
  return db.transaction(async (tx) => {
    await lockAccountById(tx, ref.coachId);
    const [row] = z.array(targetRowSchema).parse(
      await tx
        .select({
          id: assignments.id,
          playerId: assignments.playerId,
          groupId: assignments.groupId,
        })
        .from(assignments)
        .where(
          and(
            eq(assignments.id, ref.assignmentId),
            eq(assignments.coachId, ref.coachId),
          ),
        )
        .for('update'),
    );
    if (row === undefined) return NOT_FOUND;
    const players = await playersReached(tx, [row]);
    await changeAssignments(
      tx,
      { coachId: ref.coachId, playerIds: players, reason: 'unassigned', now },
      () => tx.delete(assignments).where(eq(assignments.id, row.id)),
    );
    return DONE;
  });
}

/**
 * Ends every assignment of the repertoire, each player who loses it getting
 * a `deleted` fork offer, before the repertoire is deleted in the same
 * transaction (R-131, plan decision 5). The caller holds the owner's row;
 * only the owner's repertoires are settled (changeAssignments).
 */
export async function unassignAll(
  tx: Tx,
  {
    ownerId,
    repertoireId,
  }: { readonly ownerId: string; readonly repertoireId: string },
  now: Date,
): Promise<void> {
  const rows = z.array(targetRowSchema).parse(
    await tx
      .select({
        id: assignments.id,
        playerId: assignments.playerId,
        groupId: assignments.groupId,
      })
      .from(assignments)
      .where(eq(assignments.repertoireId, repertoireId))
      .for('update'),
  );
  if (rows.length === 0) return;
  await changeAssignments(
    tx,
    {
      coachId: ownerId,
      playerIds: await playersReached(tx, rows),
      reason: 'deleted',
      now,
    },
    () =>
      tx.delete(assignments).where(eq(assignments.repertoireId, repertoireId)),
  );
}

/** A coach's new deadline for one of their assignments. */
export interface DeadlineChange extends AssignmentRef {
  /** Already parsed by deadlineSchema; null clears it. */
  readonly deadline: string | null;
}

/**
 * Extends, moves or clears the deadline of the coach's own assignment
 * (R-51); another coach's assignment is not found.
 */
export async function setDeadline(
  db: Executor,
  change: DeadlineChange,
): Promise<AssignmentResult> {
  if (!isUuid(change.assignmentId)) return NOT_FOUND;
  const updated = await db
    .update(assignments)
    .set({ deadline: change.deadline })
    .where(
      and(
        eq(assignments.id, change.assignmentId),
        eq(assignments.coachId, change.coachId),
      ),
    )
    .returning({ id: assignments.id });
  return updated.length === 1 ? DONE : NOT_FOUND;
}
