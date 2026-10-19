/**
 * A Player's repertoires (S3). Every query filters by owner as well as by
 * id: the domain decides who may see a repertoire (canViewRepertoire), and
 * the query enforces it again (CLAUDE.md, decision 12).
 */
import {
  emptyGraph,
  sideSchema,
  type RepertoireGraph,
  type Side,
} from '@mychess/chess';
import {
  REPERTOIRE_REFUSALS,
  repertoireSchema,
  type Repertoire,
  type RepertoireAccessRefusal,
  type Result,
} from '@mychess/domain';
import { and, asc, eq, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { Executor } from '../client';
import { DONE, refusal } from '../results';
import {
  chapters,
  moveChapters,
  repertoireMoves,
  repertoires,
} from '../schema';
import { diffRepertoire } from './diff';
import {
  chapterRowsSchema,
  graphOf,
  linkRowsSchema,
  moveRowsSchema,
} from './rows';
import { writeDiff } from './write';

export interface LoadedRepertoire {
  readonly repertoire: Repertoire;
  readonly graph: RepertoireGraph;
}

const metaColumns = {
  id: repertoires.id,
  ownerId: repertoires.ownerAccountId,
  side: repertoires.side,
  name: repertoires.name,
  version: repertoires.version,
  createdAt: repertoires.createdAt,
  updatedAt: repertoires.updatedAt,
};

const ownedBy = (id: string, ownerId: string) =>
  and(eq(repertoires.id, id), eq(repertoires.ownerAccountId, ownerId));

const idRowsSchema = z.array(z.object({ id: z.uuid() }));

export interface NewRepertoire {
  readonly ownerId: string;
  readonly side: Side;
  /** Already checked by the domain's repertoireNameSchema. */
  readonly name: string;
  readonly graph: RepertoireGraph;
  readonly now: Date;
}

/** A new repertoire with its whole graph, in one transaction; returns its id. */
export async function createRepertoire(
  db: Executor,
  input: NewRepertoire,
): Promise<string> {
  return db.transaction(async (tx) => {
    const [row] = idRowsSchema.parse(
      await tx
        .insert(repertoires)
        .values({
          ownerAccountId: input.ownerId,
          side: input.side,
          name: input.name,
          createdAt: input.now,
          updatedAt: input.now,
        })
        .returning({ id: repertoires.id }),
    );
    if (row === undefined) throw new Error('createRepertoire: no row returned');
    await writeDiff(
      tx,
      row.id,
      diffRepertoire(emptyGraph(input.side), input.graph),
    );
    return row.id;
  });
}

/** The graph of repertoire `id` (its access already checked), read on `tx`. */
async function graphRows(
  tx: Executor,
  id: string,
  side: Side,
): Promise<RepertoireGraph> {
  const chapterRows = chapterRowsSchema.parse(
    await tx
      .select({
        chapterId: chapters.chapterId,
        rootKey: chapters.rootKey,
        nameSource: chapters.nameSource,
        intro: chapters.intro,
      })
      .from(chapters)
      .where(eq(chapters.repertoireId, id))
      .orderBy(asc(chapters.ord)),
  );
  const moveRows = moveRowsSchema.parse(
    await tx
      .select({
        id: repertoireMoves.id,
        fromKey: repertoireMoves.fromKey,
        san: repertoireMoves.san,
        toKey: repertoireMoves.toKey,
        uci: repertoireMoves.uci,
        arrows: repertoireMoves.arrows,
        circles: repertoireMoves.circles,
        comment: repertoireMoves.comment,
      })
      .from(repertoireMoves)
      .where(eq(repertoireMoves.repertoireId, id))
      .orderBy(asc(repertoireMoves.ord)),
  );
  const links = linkRowsSchema.parse(
    await tx
      .select({
        moveId: moveChapters.moveId,
        chapterId: moveChapters.chapterId,
      })
      .from(moveChapters)
      .where(eq(moveChapters.repertoireId, id)),
  );
  return graphOf(side, chapterRows, moveRows, links);
}

/**
 * The one repertoire `where` selects, with its graph, read on `tx`, or
 * undefined. `where` is the access filter: loadRepertoire's owner filter,
 * or sharedRepertoireForCoach's share (shares.ts). Run it in a snapshot
 * transaction so the row and graph agree. Package-internal.
 */
export async function loadRepertoireRows(
  tx: Executor,
  where: SQL | undefined,
): Promise<LoadedRepertoire | undefined> {
  const [row] = await tx
    .select(metaColumns)
    .from(repertoires)
    .where(where)
    .limit(1);
  if (row === undefined) return undefined;
  const repertoire = repertoireSchema.parse(row);
  return {
    repertoire,
    graph: await graphRows(tx, repertoire.id, repertoire.side),
  };
}

/**
 * The repertoire `id` of `ownerId` with its graph, read in one snapshot, or
 * undefined (missing or someone else's: the query filters by owner, as the
 * domain's access rule does). `id` must be a uuid (parse it first).
 */
export async function loadRepertoire(
  db: Executor,
  id: string,
  ownerId: string,
): Promise<LoadedRepertoire | undefined> {
  return db.transaction((tx) => loadRepertoireRows(tx, ownedBy(id, ownerId)), {
    isolationLevel: 'repeatable read',
  });
}

/** All of `ownerId`'s repertoires with their graphs, oldest first, read in one snapshot. */
export async function loadRepertoires(
  db: Executor,
  ownerId: string,
): Promise<LoadedRepertoire[]> {
  return db.transaction(
    async (tx) => {
      const owned = z
        .array(repertoireSchema)
        .parse(
          await tx
            .select(metaColumns)
            .from(repertoires)
            .where(eq(repertoires.ownerAccountId, ownerId))
            .orderBy(asc(repertoires.createdAt), asc(repertoires.id)),
        );
      const loaded: LoadedRepertoire[] = [];
      for (const repertoire of owned)
        loaded.push({
          repertoire,
          graph: await graphRows(tx, repertoire.id, repertoire.side),
        });
      return loaded;
    },
    { isolationLevel: 'repeatable read' },
  );
}

export interface RepertoireEdit {
  readonly id: string;
  readonly ownerId: string;
  /** The version the caller computed `after` from. */
  readonly expectedVersion: number;
  readonly after: RepertoireGraph;
  readonly now: Date;
}

const versionRowsSchema = z.array(
  z.object({ version: z.number().int(), side: sideSchema }),
);

/**
 * Saves an edit (a builder edit or an import into the repertoire, decision
 * 6): bumps the version only from `expectedVersion`, which locks the row,
 * then reads the stored graph and writes the minimal diff to `after`, in one
 * transaction. The stored graph is read here, never taken from the caller,
 * so the diff is always against what is stored. A stale version (or a
 * repertoire not this owner's) is refused and nothing is written.
 */
export async function saveRepertoireEdit(
  db: Executor,
  edit: RepertoireEdit,
): Promise<
  Result<{ version: number }, { reason: typeof REPERTOIRE_REFUSALS.stale }>
> {
  return db.transaction(async (tx) => {
    const [row] = versionRowsSchema.parse(
      await tx
        .update(repertoires)
        .set({ version: sql`${repertoires.version} + 1`, updatedAt: edit.now })
        .where(
          and(
            ownedBy(edit.id, edit.ownerId),
            eq(repertoires.version, edit.expectedVersion),
          ),
        )
        .returning({ version: repertoires.version, side: repertoires.side }),
    );
    if (row === undefined) return refusal(REPERTOIRE_REFUSALS.stale);
    const before = await graphRows(tx, edit.id, row.side);
    await writeDiff(tx, edit.id, diffRepertoire(before, edit.after));
    return { ok: true, value: { version: row.version } };
  });
}

export interface RepertoireListItem {
  readonly id: string;
  readonly side: Side;
  readonly name: string;
  readonly chapters: number;
  readonly moves: number;
  readonly updatedAt: Date;
}

/**
 * The count of `table`'s rows of the listed repertoire. The outer id is
 * qualified by hand: drizzle renders a select field's column unqualified,
 * and a bare "id" would bind to the counted table's own id.
 */
const rowsOf = (table: typeof chapters | typeof repertoireMoves) =>
  sql<number>`(select count(*)::int from ${table} x where x.repertoire_id = ${repertoires}.id)`;

const listRowsSchema = z.array(
  z.object({
    id: z.uuid(),
    side: sideSchema,
    name: z.string(),
    chapters: z.number().int(),
    moves: z.number().int(),
    updatedAt: z.date(),
  }),
);

/** The owner's repertoires, oldest first, with their chapter and move counts. */
export async function listRepertoires(
  db: Executor,
  ownerId: string,
): Promise<RepertoireListItem[]> {
  return listRowsSchema.parse(
    await db
      .select({
        id: repertoires.id,
        side: repertoires.side,
        name: repertoires.name,
        chapters: rowsOf(chapters),
        moves: rowsOf(repertoireMoves),
        updatedAt: repertoires.updatedAt,
      })
      .from(repertoires)
      .where(eq(repertoires.ownerAccountId, ownerId))
      .orderBy(asc(repertoires.createdAt), asc(repertoires.id)),
  );
}

export interface RepertoireRename {
  readonly id: string;
  readonly ownerId: string;
  /** Already checked by the domain's repertoireNameSchema. */
  readonly name: string;
  readonly now: Date;
}

type RepertoireAccess = Result<undefined, RepertoireAccessRefusal>;

/** DONE when exactly the owner's repertoire was changed, else not found. */
const accessOf = (rows: readonly unknown[]): RepertoireAccess =>
  rows.length === 1 ? DONE : refusal(REPERTOIRE_REFUSALS.notFound);

/** Renames the owner's repertoire; not found when it is not theirs. No version bump (decision 10). */
export async function renameRepertoire(
  db: Executor,
  rename: RepertoireRename,
): Promise<RepertoireAccess> {
  const rows = idRowsSchema.parse(
    await db
      .update(repertoires)
      .set({ name: rename.name, updatedAt: rename.now })
      .where(ownedBy(rename.id, rename.ownerId))
      .returning({ id: repertoires.id }),
  );
  return accessOf(rows);
}

/** Deletes the owner's repertoire (its rows go by cascade); not found when it is not theirs. */
export async function deleteRepertoire(
  db: Executor,
  id: string,
  ownerId: string,
): Promise<RepertoireAccess> {
  const rows = idRowsSchema.parse(
    await db
      .delete(repertoires)
      .where(ownedBy(id, ownerId))
      .returning({ id: repertoires.id }),
  );
  return accessOf(rows);
}
