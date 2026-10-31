/**
 * A Player's repertoires (S3). Every query filters by owner as well as by
 * id through repertoireScope (scope.ts): the domain decides who may see or
 * change a repertoire (canViewRepertoire, canEditRepertoire), and the
 * query enforces it again (CLAUDE.md, decision 12).
 */
import {
  emptyGraph,
  graphChanges,
  sideSchema,
  type RepertoireGraph,
  type Side,
} from '@mychess/chess';
import {
  canAddRepertoire,
  canHoldMoves,
  ownScope,
  ok,
  refuse,
  REPERTOIRE_REFUSALS,
  repertoireSchema,
  type Account,
  type Repertoire,
  type RepertoireAccessRefusal,
  type RepertoireLimitRefusal,
  type Result,
} from '@mychess/domain';
import { asc, eq, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { lockAccountById } from '../accounts';
import { REPEATABLE_READ, type Executor, type Tx } from '../client';
import { countSchema } from '../coach-queries';
import {
  chapters,
  moveChapters,
  repertoireMoves,
  repertoires,
} from '../schema';
import {
  chapterRowsSchema,
  graphOf,
  linkRowsSchema,
  moveRowsSchema,
} from './rows';
import { repertoireScope } from './scope';
import { writeChanges } from './write';

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

const idRowsSchema = z.array(z.object({ id: z.uuid() }));

export interface NewRepertoire {
  readonly ownerId: string;
  readonly side: Side;
  /** Already checked by the domain's repertoireNameSchema. */
  readonly name: string;
  readonly graph: RepertoireGraph;
  readonly now: Date;
}

/** How many repertoires `ownerId` owns, forks included (R-162). */
const repertoireCount = async (db: Executor, ownerId: string) =>
  countSchema.parse(
    await db.$count(
      repertoires,
      repertoireScope(db, ownScope(ownerId), 'view'),
    ),
  );

/** Whether a new repertoire is held to the owner's R-162 limits. */
type Limits = 'enforced' | 'beyond';

/**
 * May the owner hold `input` as one more repertoire (R-162)? Decided with
 * the owner's account row locked (the S4 lock order; a fork has locked its
 * coach before), so two creations at 49 cannot both pass. A missing owner
 * is a programmer error.
 */
async function withinLimits(
  tx: Tx,
  input: NewRepertoire,
  limits: Limits,
): Promise<Result<undefined, RepertoireLimitRefusal>> {
  const owner = await lockAccountById(tx, input.ownerId);
  if (owner === undefined) throw new Error('createRepertoire: no owner');
  if (limits === 'beyond') return ok();
  const room = canAddRepertoire(owner, await repertoireCount(tx, owner.id));
  if (!room.ok) return room;
  return canHoldMoves(owner, { before: 0, after: input.graph.moves.length });
}

/**
 * A new repertoire with its whole graph, in one transaction; returns its
 * id. Refused over the owner's R-162 limits, writing nothing.
 */
export function createRepertoire(
  db: Executor,
  input: NewRepertoire,
): Promise<Result<string, RepertoireLimitRefusal>> {
  return insertRepertoire(db, input, 'enforced');
}

/**
 * createRepertoire made past the owner's R-162 limits: only for the
 * automatic fork of a deleting coach (R-163), never for anything a person
 * asks for. Package-internal: not exported from the package index.
 */
export function createRepertoireBeyondLimits(
  db: Executor,
  input: NewRepertoire,
): Promise<Result<string, RepertoireLimitRefusal>> {
  return insertRepertoire(db, input, 'beyond');
}

function insertRepertoire(
  db: Executor,
  input: NewRepertoire,
  limits: Limits,
): Promise<Result<string, RepertoireLimitRefusal>> {
  return db.transaction(async (tx) => {
    const allowed = await withinLimits(tx, input, limits);
    if (!allowed.ok) return allowed;
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
    await writeChanges(
      tx,
      row.id,
      graphChanges(emptyGraph(input.side), input.graph),
    );
    return ok(row.id);
  });
}

/**
 * May `owner` add a repertoire now (R-162)? A read without locks, so an
 * import preview can warn before the person confirms; createRepertoire
 * decides again under the lock.
 */
export async function mayAddRepertoire(
  db: Executor,
  owner: Pick<Account, 'id' | 'entitlement'>,
): Promise<Result<undefined, RepertoireLimitRefusal>> {
  return canAddRepertoire(owner, await repertoireCount(db, owner.id));
}

/**
 * The graph of repertoire `id` (its access already checked), read on `tx`.
 * Package-internal.
 */
export async function graphRows(
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
 * The one repertoire `where` selects, without its graph, locked FOR NO KEY
 * UPDATE until `tx` ends, or undefined. The strength an UPDATE of the row's
 * version takes: an edit waits for a fork's FOR SHARE read and for a delete,
 * and never for an assign's or a personal note's FOR KEY SHARE (#276
 * decision 2). `where` is the access filter, a repertoireScope (scope.ts).
 * Package-internal.
 */
export async function lockForEdit(
  tx: Executor,
  where: SQL | undefined,
): Promise<Repertoire | undefined> {
  const [row] = await tx
    .select(metaColumns)
    .from(repertoires)
    .where(where)
    .limit(1)
    .for('no key update');
  return row === undefined ? undefined : repertoireSchema.parse(row);
}

/**
 * The one repertoire `where` selects, with its graph, read on `tx`, or
 * undefined. `where` is the access filter, a repertoireScope (scope.ts).
 * Run it in a snapshot
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
  return db.transaction(
    (tx) =>
      loadRepertoireRows(
        tx,
        repertoireScope(tx, ownScope(ownerId), 'view', id),
      ),
    REPEATABLE_READ,
  );
}

/** All of `ownerId`'s repertoires with their graphs, oldest first, read in one snapshot. */
export async function loadRepertoires(
  db: Executor,
  ownerId: string,
): Promise<LoadedRepertoire[]> {
  return db.transaction(async (tx) => {
    const owned = z.array(repertoireSchema).parse(
      await tx
        .select(metaColumns)
        .from(repertoires)
        .where(repertoireScope(tx, ownScope(ownerId), 'view'))
        .orderBy(asc(repertoires.createdAt), asc(repertoires.id)),
    );
    const loaded: LoadedRepertoire[] = [];
    for (const repertoire of owned)
      loaded.push({
        repertoire,
        graph: await graphRows(tx, repertoire.id, repertoire.side),
      });
    return loaded;
  }, REPEATABLE_READ);
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
      .where(repertoireScope(db, ownScope(ownerId), 'view'))
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

/** Success when exactly the owner's repertoire was changed, else not found. */
const accessOf = (rows: readonly unknown[]): RepertoireAccess =>
  rows.length === 1 ? ok() : refuse(REPERTOIRE_REFUSALS.notFound);

/** Renames the owner's repertoire; not found when it is not theirs. No version bump (decision 10). */
export async function renameRepertoire(
  db: Executor,
  rename: RepertoireRename,
): Promise<RepertoireAccess> {
  const rows = idRowsSchema.parse(
    await db
      .update(repertoires)
      .set({ name: rename.name, updatedAt: rename.now })
      .where(repertoireScope(db, ownScope(rename.ownerId), 'edit', rename.id))
      .returning({ id: repertoires.id }),
  );
  return accessOf(rows);
}
