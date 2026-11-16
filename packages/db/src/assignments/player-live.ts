/**
 * The reads every player view of their assignments shares (R-16, R-46,
 * R-128, R-133). The domain decides access: each read keeps only the
 * assignmentFacts canUseAssignment allows (usableAssignments). The query
 * enforces it again: every statement filters by the session player and
 * reads the repertoire, its notes and its changes only through the
 * `assigned` repertoireScope. Callers run them in one repeatable-read
 * snapshot.
 */
import { allLearned, playerKeys, type RepertoireGraph } from '@mychess/chess';
import {
  assignedScope,
  assignmentStatusOf,
  canUseAssignment,
  type AssignmentFacts,
  type SeenFacts,
} from '@mychess/domain';
import { inArray, type Column, type SQL } from 'drizzle-orm';
import type { Executor } from '../client';
import {
  loadRepertoireRows,
  type LoadedRepertoire,
} from '../repertoires/repository';
import { repertoireScope } from '../repertoires/scope';
import { repertoires } from '../schema';
import { learnedKeys } from '../training/reviews';
import { assignmentFacts } from './reach';

/** A usable assignment with its repertoire, loaded through the `assigned` scope. */
export interface LiveAssignment {
  readonly assignment: AssignmentFacts;
  readonly loaded: LoadedRepertoire;
}

/**
 * The player's assignments canUseAssignment lets them use (assigned now,
 * not forked), by repertoire id; of one repertoire when `repertoireId` is given.
 */
async function usableAssignments(
  db: Executor,
  playerId: string,
  repertoireId?: string,
): Promise<AssignmentFacts[]> {
  const facts = await assignmentFacts(
    db,
    repertoireId === undefined
      ? { playerIds: [playerId] }
      : { playerIds: [playerId], repertoireId },
  );
  return facts.filter((one) => canUseAssignment(one).ok);
}

/** The player's usable assignment of `repertoireId`, else undefined. */
export async function usableAssignment(
  db: Executor,
  playerId: string,
  repertoireId: string,
): Promise<AssignmentFacts | undefined> {
  const [usable] = await usableAssignments(db, playerId, repertoireId);
  return usable;
}

/** What "Updated" and the news of a change depend on (R-133, R-136). */
export const seenFacts = (assignment: AssignmentFacts): SeenFacts => ({
  seenVersion: assignment.seenVersion,
  starts: assignment.reaches,
});

/**
 * Each assignment the player may use (canUseAssignment) with its
 * repertoire, loaded through the `assigned` repertoireScope.
 */
export async function loadLive(
  tx: Executor,
  playerId: string,
): Promise<LiveAssignment[]> {
  const live = [];
  for (const assignment of await usableAssignments(tx, playerId)) {
    const loaded = await loadRepertoireRows(
      tx,
      repertoireScope(
        tx,
        assignedScope(playerId),
        'view',
        assignment.repertoireId,
      ),
    );
    if (loaded !== undefined) live.push({ assignment, loaded });
  }
  return live;
}

/**
 * The player's learned set (R-129) among the player moves of `graphs`:
 * the keys of them they learned or skipped.
 */
export async function learnedOf(
  db: Executor,
  playerId: string,
  graphs: readonly RepertoireGraph[],
): Promise<ReadonlySet<string>> {
  const keys = [...new Set(graphs.flatMap((graph) => playerKeys(graph)))];
  return (await learnedKeys(db, [playerId], keys)).get(playerId) ?? new Set();
}

/** What the domain says of a live assignment at `now` (R-16, R-46, R-51, R-129, R-134). */
interface LiveStatus {
  readonly deadline: string | null;
  readonly paused: boolean;
  readonly done: boolean;
  readonly overdue: boolean;
}

export function statusOf(
  { assignment, loaded }: LiveAssignment,
  learned: ReadonlySet<string>,
  now: Date,
): LiveStatus {
  const done = allLearned(loaded.graph, learned);
  const status = assignmentStatusOf(assignment, { done, now });
  return {
    deadline: status.deadline,
    paused: status.paused,
    done: status.done,
    overdue: status.overdue,
  };
}

/** The repertoire's id while it is live for the player, as a subquery. */
const liveId = (db: Executor, playerId: string, repertoireId: string) =>
  db
    .select({ id: repertoires.id })
    .from(repertoires)
    .where(repertoireScope(db, assignedScope(playerId), 'view', repertoireId));

/** `column` names the repertoire while it is live for the player. */
export const inLive = (
  db: Executor,
  column: Column,
  { playerId, repertoireId }: { playerId: string; repertoireId: string },
): SQL => inArray(column, liveId(db, playerId, repertoireId));
