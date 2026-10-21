/**
 * How an assignment reaches a player, written once (#288). Two code words:
 *
 * - a row *reaches* a player when it is the player's own row, or a row of a
 *   group the player is in (R-16), and the coach is linked to that player.
 *   The link foreign keys already guarantee the link; the `exists` check is
 *   the query's second line, and being a WHERE subquery it locks nothing;
 * - an assignment is *live* for a player when a row reaches them and they
 *   have not forked it (R-128).
 *
 * This module only reads the facts (`AssignmentFacts`, one record per
 * player and repertoire); the domain decides on them (`canUseAssignment`,
 * `canFork`, `assignmentStatusOf`, `settleAssignmentChange`). Only
 * `holdAssignment` locks, and it never locks an account row, so the S4 lock
 * order (the coach's account row first) cannot invert. Internal to the
 * package.
 */
import type { AssignmentFacts, AssignmentReach } from '@mychess/domain';
import {
  and,
  eq,
  inArray,
  isNotNull,
  notExists,
  notInArray,
  or,
  sql,
  type Column,
  type SQL,
} from 'drizzle-orm';
import { QueryBuilder } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import type { Executor, Tx } from '../client';
import { assignmentPlayers, assignments } from '../assignment-schema';
import { playerRowsSchema } from '../coach-queries';
import { isUuid } from '../ids';
import { coachLinks, groupMembers, repertoires } from '../schema';

/**
 * Whose assignments to read: some players, a coach's, or both, optionally
 * of one repertoire. At least one of `playerIds` and `coachId` is given.
 */
export type ReachScope =
  | {
      readonly playerIds: readonly string[];
      readonly coachId?: string;
      readonly repertoireId?: string;
    }
  | { readonly coachId: string; readonly repertoireId?: string };

/** The player and one repertoire: the key of their state on it. */
export interface ReachKey {
  /** The session account, never a client value. */
  readonly playerId: string;
  readonly repertoireId: string;
}

/** An assignment's target as its columns: exactly one is set. */
export interface ReachTarget {
  readonly playerId: string | null;
  readonly groupId: string | null;
}

/** Narrows reach to some players: `player` is the reached player's column. */
type PlayerFilter = (player: Column) => SQL | undefined;

/** The coach of the row is linked to `player` (the second line). */
const linked = (player: Column): SQL =>
  sql`exists (select 1 from ${coachLinks} where ${coachLinks.coachId} = ${assignments.coachId} and ${coachLinks.playerId} = ${player})`;

/** A player row reaching the players `filter` keeps. */
const ownRowReaching = (filter: PlayerFilter): SQL | undefined =>
  and(
    isNotNull(assignments.playerId),
    filter(assignments.playerId),
    linked(assignments.playerId),
  );

/** A group row reaching a member `filter` keeps (with `memberJoin`). */
const groupRowReaching = (filter: PlayerFilter): SQL | undefined =>
  and(filter(groupMembers.playerId), linked(groupMembers.playerId));

const memberJoin = eq(groupMembers.groupId, assignments.groupId);

const inScope =
  (scope: ReachScope): PlayerFilter =>
  (player) =>
    and(
      'playerIds' in scope ? inArray(player, [...scope.playerIds]) : undefined,
      scope.coachId === undefined
        ? undefined
        : eq(assignments.coachId, scope.coachId),
      scope.repertoireId === undefined
        ? undefined
        : eq(assignments.repertoireId, scope.repertoireId),
    );

const reachRowsSchema = z.array(
  z.object({
    assignmentId: z.uuid(),
    playerId: z.string().min(1),
    repertoireId: z.uuid(),
    coachId: z.string().min(1),
    deadline: z.iso.date().nullable(),
    assignedVersion: z.number().int(),
    joinedAt: z.date().nullable(),
  }),
);
type ReachRow = z.infer<typeof reachRowsSchema>[number];

const stateRowsSchema = z.array(
  z.object({
    playerId: z.string().min(1),
    repertoireId: z.uuid(),
    pausedAt: z.date().nullable(),
    seenVersion: z.number().int().nullable(),
    forkedAt: z.date().nullable(),
  }),
);
type StateRow = z.infer<typeof stateRowsSchema>[number];

const reachColumns = {
  assignmentId: assignments.id,
  repertoireId: assignments.repertoireId,
  coachId: assignments.coachId,
  deadline: assignments.deadline,
  assignedVersion: assignments.assignedVersion,
};

const stateColumns = {
  playerId: assignmentPlayers.playerId,
  repertoireId: assignmentPlayers.repertoireId,
  pausedAt: assignmentPlayers.pausedAt,
  seenVersion: assignmentPlayers.seenVersion,
  forkedAt: assignmentPlayers.forkedAt,
};

/** The player's own row has no join time. */
const noJoin = sql<Date | null>`null::timestamptz`;

const ownRows = (db: Executor, filter: PlayerFilter) =>
  db
    .select({
      ...reachColumns,
      playerId: assignments.playerId,
      joinedAt: noJoin,
    })
    .from(assignments)
    .where(ownRowReaching(filter));

const groupRows = (db: Executor, filter: PlayerFilter) =>
  db
    .select({
      ...reachColumns,
      playerId: groupMembers.playerId,
      joinedAt: groupMembers.joinedAt,
    })
    .from(assignments)
    .innerJoin(groupMembers, memberJoin)
    .where(groupRowReaching(filter));

/**
 * The rows reaching the players `filter` keeps: two statements, as FOR KEY
 * SHARE cannot go with a union. `hold` locks them (the group statement both
 * the assignment and the membership) until the transaction ends.
 */
async function reachRows(
  db: Executor,
  filter: PlayerFilter,
  hold: boolean,
): Promise<ReachRow[]> {
  const own = ownRows(db, filter);
  const viaGroups = groupRows(db, filter);
  const ownFound = await (hold ? own.for('key share') : own);
  const groupFound = await (hold ? viaGroups.for('key share') : viaGroups);
  return reachRowsSchema.parse([...ownFound, ...groupFound]);
}

const unique = (ids: readonly string[]): string[] => [...new Set(ids)];

/** The players' states on the pairs `rows` found; unlocked. */
async function statesOf(
  db: Executor,
  rows: readonly ReachRow[],
): Promise<StateRow[]> {
  if (rows.length === 0) return [];
  return stateRowsSchema.parse(
    await db
      .select(stateColumns)
      .from(assignmentPlayers)
      .where(
        and(
          inArray(
            assignmentPlayers.playerId,
            unique(rows.map((r) => r.playerId)),
          ),
          inArray(
            assignmentPlayers.repertoireId,
            unique(rows.map((r) => r.repertoireId)),
          ),
        ),
      ),
  );
}

const pairKey = (pair: { playerId: string; repertoireId: string }): string =>
  JSON.stringify([pair.playerId, pair.repertoireId]);

const compare = (a: string, b: string): number => Number(a > b) - Number(a < b);

const byPair = (a: AssignmentFacts, b: AssignmentFacts): number =>
  compare(a.playerId, b.playerId) || compare(a.repertoireId, b.repertoireId);

/** The player's own row first, then group rows by assignment id. */
const ownFirst = (a: AssignmentReach, b: AssignmentReach): number =>
  Number(a.joinedAt !== null) - Number(b.joinedAt !== null) ||
  compare(a.assignmentId, b.assignmentId);

const toReach = (row: ReachRow): AssignmentReach => ({
  assignmentId: row.assignmentId,
  deadline: row.deadline,
  assignedVersion: row.assignedVersion,
  joinedAt: row.joinedAt,
});

const NO_STATE = { pausedAt: null, seenVersion: null, forkedAt: null };

function recordOf(
  rows: readonly [ReachRow, ...ReachRow[]],
  state: Pick<StateRow, 'pausedAt' | 'seenVersion' | 'forkedAt'>,
): AssignmentFacts {
  const [first] = rows;
  return {
    playerId: first.playerId,
    repertoireId: first.repertoireId,
    coachId: first.coachId,
    reaches: rows.map(toReach).sort(ownFirst),
    pausedAt: state.pausedAt,
    seenVersion: state.seenVersion,
    forkedAt: state.forkedAt,
  };
}

const isNonEmpty = <T>(list: readonly T[]): list is readonly [T, ...T[]] =>
  list.length > 0;

/** One record per pair the rows reach, by player then repertoire. */
function factsOf(
  rows: readonly ReachRow[],
  states: readonly StateRow[],
): AssignmentFacts[] {
  const stateOf = new Map(states.map((state) => [pairKey(state), state]));
  const grouped = new Map<string, ReachRow[]>();
  for (const row of rows) {
    const key = pairKey(row);
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  return [...grouped]
    .flatMap(([key, list]) =>
      isNonEmpty(list) ? [recordOf(list, stateOf.get(key) ?? NO_STATE)] : [],
    )
    .sort(byPair);
}

/** A scope that can name no row: no players, or a malformed repertoire id. */
const namesNothing = (scope: ReachScope): boolean =>
  ('playerIds' in scope && scope.playerIds.length === 0) ||
  (scope.repertoireId !== undefined && !isUuid(scope.repertoireId));

/**
 * What is known of every (player, repertoire) pair a row reaches in
 * `scope`, forked or not, by player then repertoire; unlocked. Three
 * statements whatever the batch (two when nothing is reached).
 */
export async function assignmentFacts(
  db: Executor,
  scope: ReachScope,
): Promise<AssignmentFacts[]> {
  if (namesNothing(scope)) return [];
  const rows = await reachRows(db, inScope(scope), false);
  return factsOf(rows, await statesOf(db, rows));
}

/**
 * The facts of one pair, with the rows reaching the player (FOR KEY SHARE)
 * and their state on it (FOR UPDATE, whether or not anything reaches them)
 * held until `tx` ends; undefined when no row reaches them. A pause, seen,
 * note or fork holds these, so an unassign, unlink, group leave or
 * repertoire delete waits for it and then drops the state it wrote, or
 * came first and leaves nothing to hold.
 */
export async function holdAssignment(
  tx: Tx,
  key: ReachKey,
): Promise<AssignmentFacts | undefined> {
  if (!isUuid(key.repertoireId)) return undefined;
  const rows = await reachRows(
    tx,
    inScope({ playerIds: [key.playerId], repertoireId: key.repertoireId }),
    true,
  );
  const states = stateRowsSchema.parse(
    await tx
      .select(stateColumns)
      .from(assignmentPlayers)
      .where(
        and(
          eq(assignmentPlayers.playerId, key.playerId),
          eq(assignmentPlayers.repertoireId, key.repertoireId),
        ),
      )
      .for('update'),
  );
  return factsOf(rows, states)[0];
}

/**
 * Repertoire `repertoireId` if it is live for `playerId`, as a filter on
 * `repertoires.id` (R-16, R-128): the query-level line beside
 * canUseAssignment.
 */
export function liveRepertoire(
  db: Executor,
  playerId: string,
  repertoireId: string,
): SQL | undefined {
  const filter = inScope({ playerIds: [playerId], repertoireId });
  const own = db
    .select({ id: assignments.repertoireId })
    .from(assignments)
    .where(ownRowReaching(filter));
  const viaGroups = db
    .select({ id: assignments.repertoireId })
    .from(assignments)
    .innerJoin(groupMembers, memberJoin)
    .where(groupRowReaching(filter));
  const forked = db
    .select({ id: assignmentPlayers.repertoireId })
    .from(assignmentPlayers)
    .where(
      and(
        eq(assignmentPlayers.playerId, playerId),
        isNotNull(assignmentPlayers.forkedAt),
      ),
    );
  return and(
    eq(repertoires.id, repertoireId),
    or(inArray(repertoires.id, own), inArray(repertoires.id, viaGroups)),
    notInArray(repertoires.id, forked),
  );
}

/** Builds the stale-state subqueries, which need no executor. */
const qb = new QueryBuilder();

/** A row for the same player and repertoire as the `assignment_players` row. */
const sameStatePair: PlayerFilter = (player) =>
  and(
    eq(player, assignmentPlayers.playerId),
    eq(assignments.repertoireId, assignmentPlayers.repertoireId),
  );

/**
 * The `assignment_players` rows of `playerIds` that no row reaches any
 * more, forked or not, whoever's: the stale state a change drops (plan
 * decision 4).
 */
export const unreachedState = (playerIds: readonly string[]): SQL | undefined =>
  and(
    inArray(assignmentPlayers.playerId, [...playerIds]),
    notExists(
      qb
        .select({ one: sql`1` })
        .from(assignments)
        .where(ownRowReaching(sameStatePair)),
    ),
    notExists(
      qb
        .select({ one: sql`1` })
        .from(assignments)
        .innerJoin(groupMembers, memberJoin)
        .where(groupRowReaching(sameStatePair)),
    ),
  );

/**
 * Every player the target rows reach, before or after the rows exist: a
 * player row's player, or its group's members.
 */
export async function playersReached(
  tx: Tx,
  targets: readonly ReachTarget[],
): Promise<string[]> {
  const direct = targets.flatMap((target) =>
    target.playerId === null ? [] : [target.playerId],
  );
  const groupIds = targets.flatMap((target) =>
    target.groupId === null ? [] : [target.groupId],
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
