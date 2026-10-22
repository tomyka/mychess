/**
 * A player's own writes on a repertoire they have by assignment: pause
 * (R-46) and seen (R-133). Each runs in one transaction that first holds
 * (holdAssignment in reach.ts, FOR KEY SHARE) every row the assignment
 * reaches the player through: the assignment row, and the membership for a
 * group row. An unassign, unlink, group leave or repertoire delete
 * therefore waits until the write ends and then drops the state it wrote
 * (changeAssignments' dropStaleState), or came first and leaves nothing to
 * hold. No account row is locked here, so
 * the S4 lock order (the coach's account row first) cannot invert.
 */
import {
  ASSIGNMENT_REFUSALS,
  canUseAssignment,
  ok,
  refuse,
  type AssignmentRefusal,
  type PlayerRepertoire,
  type Result,
} from '@mychess/domain';
import { sql, type SQL } from 'drizzle-orm';
import type { Db, Tx } from '../client';
import { assignmentPlayers } from '../assignment-schema';
import { isUuid } from '../ids';
import { repertoires } from '../schema';
import { holdAssignment } from './reach';

type AssignmentResult = Result<undefined, AssignmentRefusal>;

const NOT_FOUND = refuse(ASSIGNMENT_REFUSALS.notFound);

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
    return ok();
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
