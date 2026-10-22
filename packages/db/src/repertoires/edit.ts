/**
 * Editing a saved repertoire (#276): the one way to change an existing
 * repertoire's graph, a builder edit or an import into it. In one
 * transaction it holds the row through the own scope, asks the domain
 * whether this viewer may edit it from this version (canEditRepertoireAt),
 * reads the graph once, asks chess for the new graph (applyChange), writes
 * the minimal diff and records what changed for players (R-121, R-133).
 * The caller never sends a graph.
 */
import {
  applyChange,
  graphChanges,
  playerMoveChanges,
  type AppliedChange,
  type ChangeRefusal,
  type MoveChanges,
  type RepertoireChange,
  type RepertoireGraph,
} from '@mychess/chess';
import {
  canEditRepertoireAt,
  ok,
  ownScope,
  refuse,
  REPERTOIRE_REFUSALS,
  type Account,
  type RepertoireAccessRefusal,
  type RepertoireStaleRefusal,
  type Result,
} from '@mychess/domain';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { recordChanges } from '../assignments/move-changes';
import type { Executor } from '../client';
import { isUuid } from '../ids';
import { repertoires } from '../schema';
import { graphRows, lockForEdit } from './repository';
import { repertoireScope } from './scope';
import { writeChanges } from './write';

export interface RepertoireEditRequest<C extends RepertoireChange> {
  /** The repertoire's id; one that is no uuid names nothing (not found). */
  readonly id: string;
  /** The session account. */
  readonly viewer: Pick<Account, 'id'>;
  /** The version the client computed the change from. */
  readonly expectedVersion: number;
  readonly change: C;
  readonly now: Date;
}

export interface EditedRepertoire {
  readonly version: number;
  /** The graph as saved. */
  readonly graph: RepertoireGraph;
  /** What the edit changed for players (R-121, R-133), as recorded. */
  readonly changes: MoveChanges;
  readonly firstChapterId: string | null;
}

export type EditRepertoireRefusal<C extends RepertoireChange> =
  RepertoireAccessRefusal | RepertoireStaleRefusal | ChangeRefusal<C>;

const versionRowsSchema = z.array(z.object({ version: z.number().int() }));

/** Bumps the held repertoire's version; the new version. */
async function bumpVersion(
  tx: Executor,
  id: string,
  now: Date,
): Promise<number> {
  const [row] = versionRowsSchema.parse(
    await tx
      .update(repertoires)
      .set({ version: sql`${repertoires.version} + 1`, updatedAt: now })
      .where(eq(repertoires.id, id))
      .returning({ version: repertoires.version }),
  );
  if (row === undefined)
    throw new Error('editRepertoire: the held row is gone');
  return row.version;
}

/** A decided change of repertoire `id`, ready to save. */
interface DecidedEdit {
  readonly id: string;
  /** The stored graph the change was decided against. */
  readonly before: RepertoireGraph;
  readonly applied: AppliedChange;
  readonly now: Date;
}

/** Saves the decided edit: the version, then the diff, then the record. */
async function save(
  tx: Executor,
  { id, before, applied, now }: DecidedEdit,
): Promise<EditedRepertoire> {
  const version = await bumpVersion(tx, id, now);
  await writeChanges(tx, id, graphChanges(before, applied.graph));
  const changes = playerMoveChanges(before, applied.graph);
  await recordChanges(tx, { repertoireId: id, version, changes, now });
  return {
    version,
    graph: applied.graph,
    changes,
    firstChapterId: applied.firstChapterId,
  };
}

/**
 * Saves `request.change` to the viewer's own repertoire, decided against
 * the stored graph under the row lock. Refused, writing nothing: not found
 * (no uuid, sent no statement; missing; or not the viewer's: the own scope
 * filters the lock, and the domain decides again), then stale (the version
 * moved on), then the change's own refusal. Neither of the first two reads
 * the graph.
 */
export async function editRepertoire<C extends RepertoireChange>(
  db: Executor,
  request: RepertoireEditRequest<C>,
): Promise<Result<EditedRepertoire, EditRepertoireRefusal<C>>> {
  if (!isUuid(request.id)) return refuse(REPERTOIRE_REFUSALS.notFound);
  return db.transaction(async (tx) => {
    const held = await lockForEdit(
      tx,
      repertoireScope(tx, ownScope(request.viewer.id), 'edit', request.id),
    );
    if (held === undefined) return refuse(REPERTOIRE_REFUSALS.notFound);
    const allowed = canEditRepertoireAt(
      request.viewer,
      held,
      request.expectedVersion,
    );
    if (!allowed.ok) return allowed;
    const before = await graphRows(tx, held.id, held.side);
    const applied = applyChange(before, request.change);
    if (!applied.ok) return applied;
    return ok(
      await save(tx, {
        id: held.id,
        before,
        applied: applied.value,
        now: request.now,
      }),
    );
  });
}
