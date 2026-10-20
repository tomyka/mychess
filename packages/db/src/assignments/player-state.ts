/**
 * A player's own writes on a repertoire they have by assignment: pause
 * (R-46) and seen (R-133). Each runs in one transaction that first holds
 * (FOR KEY SHARE) every row the assignment reaches the player through: the
 * assignment row, and the membership for a group row. An unassign, unlink,
 * group leave or repertoire delete therefore waits until the write ends and
 * then drops the state it wrote (changeAssignments' dropStaleState), or
 * came first and leaves nothing to hold. No account row is locked here, so
 * the S4 lock order (the coach's account row first) cannot invert.
 */
import {
  ASSIGNMENT_REFUSALS,
  canUseAssignment,
  type AssignmentHold,
  type AssignmentRefusal,
  type Result,
} from '@mychess/domain';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { Db, Tx } from '../client';
import { assignmentPlayers, assignments } from '../assignment-schema';
import { isUuid } from '../ids';
import { DONE, refusal } from '../results';
import { groupMembers, repertoires } from '../schema';

type AssignmentResult = Result<undefined, AssignmentRefusal>;

const NOT_FOUND = refusal(ASSIGNMENT_REFUSALS.notFound);

/** The player and one repertoire: the key of their state on it. */
interface PlayerRepertoire {
  /** The session account, never a client value. */
  readonly playerId: string;
  readonly repertoireId: string;
}

const idRowsSchema = z.array(z.object({ id: z.uuid() }));
const forkRowsSchema = z.array(z.object({ forkedAt: z.date().nullable() }));

/** Holds the rows reaching the player; true if any does. */
async function holdReach(tx: Tx, key: PlayerRepertoire): Promise<boolean> {
  const individual = idRowsSchema.parse(
    await tx
      .select({ id: assignments.id })
      .from(assignments)
      .where(
        and(
          eq(assignments.repertoireId, key.repertoireId),
          eq(assignments.playerId, key.playerId),
        ),
      )
      .for('key share'),
  );
  const viaGroups = idRowsSchema.parse(
    await tx
      .select({ id: assignments.id })
      .from(assignments)
      .innerJoin(groupMembers, eq(groupMembers.groupId, assignments.groupId))
      .where(
        and(
          eq(assignments.repertoireId, key.repertoireId),
          eq(groupMembers.playerId, key.playerId),
        ),
      )
      .for('key share'),
  );
  return individual.length + viaGroups.length > 0;
}

const stateIs = (key: PlayerRepertoire) =>
  and(
    eq(assignmentPlayers.playerId, key.playerId),
    eq(assignmentPlayers.repertoireId, key.repertoireId),
  );

/**
 * The facts canUseAssignment decides on, with the rows that reach the
 * player held (FOR KEY SHARE) until `tx` ends. Package-internal.
 */
export async function holdAssignment(
  tx: Tx,
  key: PlayerRepertoire,
): Promise<AssignmentHold> {
  const assigned = await holdReach(tx, key);
  const [state] = forkRowsSchema.parse(
    await tx
      .select({ forkedAt: assignmentPlayers.forkedAt })
      .from(assignmentPlayers)
      .where(stateIs(key))
      .for('update'),
  );
  return { assigned, forked: (state?.forkedAt ?? null) !== null };
}

type StateColumns = Partial<{
  pausedAt: Date | null;
  seenVersion: SQL<number>;
}>;

/**
 * Writes the player's state, creating it with `values` if needed (plan
 * decision 4), else updating it with `set`.
 */
async function writeState(
  tx: Tx,
  key: PlayerRepertoire,
  values: StateColumns,
  set: StateColumns = values,
): Promise<void> {
  await tx
    .insert(assignmentPlayers)
    .values({ ...key, ...values })
    .onConflictDoUpdate({
      target: [assignmentPlayers.playerId, assignmentPlayers.repertoireId],
      set,
    });
}

/**
 * Runs `write` on the player's own live assignment of the repertoire;
 * anything else is not found and nothing is written (canUseAssignment).
 */
function onOwnAssignment(
  db: Db,
  key: PlayerRepertoire,
  write: (tx: Tx) => Promise<void>,
): Promise<AssignmentResult> {
  if (!isUuid(key.repertoireId)) return Promise.resolve(NOT_FOUND);
  return db.transaction(async (tx) => {
    const allowed = canUseAssignment(await holdAssignment(tx, key));
    if (!allowed.ok) return allowed;
    await write(tx);
    return DONE;
  });
}

/** A player's parsed request to pause or resume an assignment. */
export interface PauseRequest extends PlayerRepertoire {
  readonly paused: boolean;
}

/**
 * Pauses or resumes the player's own assignment (R-46): a paused one stays
 * assigned but leaves training (trainingRepertoires marks it inactive).
 */
export function pauseAssignment(
  db: Db,
  req: PauseRequest,
  now: Date,
): Promise<AssignmentResult> {
  const key = { playerId: req.playerId, repertoireId: req.repertoireId };
  return onOwnAssignment(db, key, (tx) =>
    writeState(tx, key, { pausedAt: req.paused ? now : null }),
  );
}

/** A player's parsed report of the version a page showed them. */
export interface SeenRequest extends PlayerRepertoire {
  readonly seenVersion: number;
}

/**
 * The player has seen the repertoire at `seenVersion`, the version the
 * page showed: "Updated" goes off unless the coach saved a later one
 * meanwhile (R-133). The stored version never goes down, below 0 or above
 * the repertoire's current version.
 */
export function markSeen(
  db: Db,
  { playerId, repertoireId, seenVersion }: SeenRequest,
): Promise<AssignmentResult> {
  const key = { playerId, repertoireId };
  const current = sql`(select ${repertoires.version} from ${repertoires} where ${repertoires.id} = ${repertoireId})`;
  return onOwnAssignment(db, key, (tx) =>
    writeState(
      tx,
      key,
      {
        seenVersion: sql<number>`greatest(0, least(${seenVersion}::int, ${current}))`,
      },
      {
        seenVersion: sql<number>`greatest(${assignmentPlayers.seenVersion}, excluded.seen_version)`,
      },
    ),
  );
}
