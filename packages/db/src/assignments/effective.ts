/**
 * A player's assignments derived from the rows (plan decision 1): the
 * individual ones, and those of every group the player is in. One entry per
 * repertoire. Internal to the package; repositories build on it.
 */
import {
  vilniusDay,
  type DeadlineSources,
  type GroupDeadline,
} from '@mychess/domain';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Executor } from '../client';
import { assignmentPlayers, assignments } from '../assignment-schema';
import { groupMembers } from '../schema';

export interface EffectiveAssignment {
  readonly repertoireId: string;
  readonly coachId: string;
  readonly sources: DeadlineSources;
  /** The lowest assigned_version among its rows. */
  readonly assignedVersion: number;
  readonly pausedAt: Date | null;
  readonly seenVersion: number | null;
  readonly forkedAt: Date | null;
}

/** An individual row has no join time; a group row has the member's. */
const rowSchema = z.object({
  repertoireId: z.uuid(),
  coachId: z.string().min(1),
  deadline: z.iso.date().nullable(),
  assignedVersion: z.number().int(),
  joinedAt: z.date().nullable(),
});
type Row = z.infer<typeof rowSchema>;

const stateSchema = z.object({
  repertoireId: z.uuid(),
  pausedAt: z.date().nullable(),
  seenVersion: z.number().int().nullable(),
  forkedAt: z.date().nullable(),
});
type State = z.infer<typeof stateSchema>;

const NO_STATE = { pausedAt: null, seenVersion: null, forkedAt: null };

const sqlNull = sql<Date | null>`null::timestamptz`;

const columns = {
  repertoireId: assignments.repertoireId,
  coachId: assignments.coachId,
  deadline: assignments.deadline,
  assignedVersion: assignments.assignedVersion,
};

async function rowsOf(db: Executor, playerId: string): Promise<Row[]> {
  const individual = await db
    .select({ ...columns, joinedAt: sqlNull })
    .from(assignments)
    .where(eq(assignments.playerId, playerId));
  const viaGroups = await db
    .select({ ...columns, joinedAt: groupMembers.joinedAt })
    .from(assignments)
    .innerJoin(groupMembers, eq(groupMembers.groupId, assignments.groupId))
    .where(eq(groupMembers.playerId, playerId));
  return z.array(rowSchema).parse([...individual, ...viaGroups]);
}

async function statesOf(
  db: Executor,
  playerId: string,
  repertoireIds: readonly string[],
): Promise<Map<string, State>> {
  if (repertoireIds.length === 0) return new Map();
  const rows = z.array(stateSchema).parse(
    await db
      .select({
        repertoireId: assignmentPlayers.repertoireId,
        pausedAt: assignmentPlayers.pausedAt,
        seenVersion: assignmentPlayers.seenVersion,
        forkedAt: assignmentPlayers.forkedAt,
      })
      .from(assignmentPlayers)
      .where(
        and(
          eq(assignmentPlayers.playerId, playerId),
          inArray(assignmentPlayers.repertoireId, [...repertoireIds]),
        ),
      ),
  );
  return new Map(rows.map((row) => [row.repertoireId, row]));
}

function byRepertoire(rows: readonly Row[]): Map<string, Row[]> {
  const grouped = new Map<string, Row[]>();
  for (const row of rows) {
    const list = grouped.get(row.repertoireId) ?? [];
    list.push(row);
    grouped.set(row.repertoireId, list);
  }
  return grouped;
}

/** The deadline sources of one repertoire's rows (R-16, R-134). */
function sourcesOf(rows: readonly Row[]): DeadlineSources {
  const groups: GroupDeadline[] = rows.flatMap((row) =>
    row.joinedAt === null
      ? []
      : [{ deadline: row.deadline, joinedDay: vilniusDay(row.joinedAt) }],
  );
  const individual = rows.find((row) => row.joinedAt === null);
  return individual === undefined
    ? { groups }
    : { individual: { deadline: individual.deadline }, groups };
}

function merge(
  rows: readonly [Row, ...Row[]],
  state: Omit<State, 'repertoireId'>,
): EffectiveAssignment {
  const [first] = rows;
  return {
    repertoireId: first.repertoireId,
    coachId: first.coachId,
    sources: sourcesOf(rows),
    assignedVersion: Math.min(...rows.map((row) => row.assignedVersion)),
    pausedAt: state.pausedAt,
    seenVersion: state.seenVersion,
    forkedAt: state.forkedAt,
  };
}

const isNonEmpty = <T>(list: readonly T[]): list is readonly [T, ...T[]] =>
  list.length > 0;

/**
 * The repertoires assigned to `playerId`, one entry each, by repertoire id.
 * Those the player forked are left out unless `withForked` (R-128).
 */
export async function effectiveAssignments(
  db: Executor,
  playerId: string,
  { withForked = false }: { readonly withForked?: boolean } = {},
): Promise<EffectiveAssignment[]> {
  const grouped = byRepertoire(await rowsOf(db, playerId));
  const ids = [...grouped.keys()].sort();
  const states = await statesOf(db, playerId, ids);
  return ids
    .flatMap((id) => {
      const rows = grouped.get(id) ?? [];
      return isNonEmpty(rows) ? [merge(rows, states.get(id) ?? NO_STATE)] : [];
    })
    .filter((assignment) => withForked || assignment.forkedAt === null);
}

/** The ids of the repertoires `playerId` has live (not forked). */
export async function liveRepertoireIds(
  db: Executor,
  playerId: string,
): Promise<Set<string>> {
  const live = await effectiveAssignments(db, playerId);
  return new Set(live.map((assignment) => assignment.repertoireId));
}
