/** Writes the GraphChanges of one edit to one repertoire. Call it inside a transaction. */
import {
  moveKey,
  type Chapter,
  type GraphChanges,
  type MoveLink,
  type RepertoireMove,
} from '@mychess/chess';
import { and, eq, inArray, max, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Executor } from '../client';
import { chapters, moveChapters, repertoireMoves } from '../schema';

/** Rows per statement: far under Postgres's 65,535 parameters. */
const BATCH = 500;

export function batches<T>(items: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += BATCH)
    out.push(items.slice(i, i + BATCH));
  return out;
}

/**
 * A row's move key, as SQL. Mirrors `moveKey` in @mychess/chess
 * (`<position key>|<SAN>`, neither part holding a `|`): change both together.
 */
const keyColumn = sql<string>`${repertoireMoves.fromKey} || '|' || ${repertoireMoves.san}`;
const ofRepertoire = (id: string) => eq(repertoireMoves.repertoireId, id);
const topSchema = z.array(z.object({ top: z.number().nullable() }));
const idRowsSchema = z.array(
  z.object({ id: z.uuid(), fromKey: z.string(), san: z.string() }),
);

async function nextChapterOrd(
  tx: Executor,
  repertoireId: string,
): Promise<number> {
  const rows = await tx
    .select({ top: max(chapters.ord) })
    .from(chapters)
    .where(eq(chapters.repertoireId, repertoireId));
  return (topSchema.parse(rows)[0]?.top ?? -1) + 1;
}

async function nextMoveOrd(
  tx: Executor,
  repertoireId: string,
): Promise<number> {
  const rows = await tx
    .select({ top: max(repertoireMoves.ord) })
    .from(repertoireMoves)
    .where(ofRepertoire(repertoireId));
  return (topSchema.parse(rows)[0]?.top ?? -1) + 1;
}

async function deleteMoves(
  tx: Executor,
  repertoireId: string,
  keys: readonly string[],
): Promise<void> {
  for (const batch of batches(keys))
    await tx
      .delete(repertoireMoves)
      .where(and(ofRepertoire(repertoireId), inArray(keyColumn, batch)));
}

/** The row ids of the moves with these keys, by move key. */
async function moveIds(
  tx: Executor,
  repertoireId: string,
  keys: readonly string[],
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const batch of batches([...new Set(keys)])) {
    const rows = await tx
      .select({
        id: repertoireMoves.id,
        fromKey: repertoireMoves.fromKey,
        san: repertoireMoves.san,
      })
      .from(repertoireMoves)
      .where(and(ofRepertoire(repertoireId), inArray(keyColumn, batch)));
    for (const row of idRowsSchema.parse(rows))
      ids.set(moveKey(row.fromKey, row.san), row.id);
  }
  return ids;
}

async function deleteLinks(
  tx: Executor,
  repertoireId: string,
  links: readonly MoveLink[],
): Promise<void> {
  const ids = await moveIds(
    tx,
    repertoireId,
    links.map((l) => l.moveKey),
  );
  for (const link of links) {
    const moveId = ids.get(link.moveKey);
    if (moveId !== undefined)
      await tx
        .delete(moveChapters)
        .where(
          and(
            eq(moveChapters.moveId, moveId),
            eq(moveChapters.chapterId, link.chapterId),
          ),
        );
  }
}

async function deleteChapters(
  tx: Executor,
  repertoireId: string,
  chapterIds: readonly string[],
): Promise<void> {
  if (chapterIds.length === 0) return;
  await tx
    .delete(chapters)
    .where(
      and(
        eq(chapters.repertoireId, repertoireId),
        inArray(chapters.chapterId, [...chapterIds]),
      ),
    );
}

async function insertChapters(
  tx: Executor,
  repertoireId: string,
  added: readonly Chapter[],
): Promise<void> {
  if (added.length === 0) return;
  const first = await nextChapterOrd(tx, repertoireId);
  await tx.insert(chapters).values(
    added.map((c, i) => ({
      repertoireId,
      chapterId: c.id,
      rootKey: c.rootKey,
      nameSource: c.nameSource,
      intro: c.intro,
      ord: first + i,
    })),
  );
}

async function updateChapters(
  tx: Executor,
  repertoireId: string,
  changed: readonly Chapter[],
): Promise<void> {
  for (const c of changed)
    await tx
      .update(chapters)
      .set({ nameSource: c.nameSource, intro: c.intro })
      .where(
        and(
          eq(chapters.repertoireId, repertoireId),
          eq(chapters.chapterId, c.id),
        ),
      );
}

const moveRow = (repertoireId: string, m: RepertoireMove, ord: number) => ({
  repertoireId,
  fromKey: m.from,
  san: m.san,
  toKey: m.to,
  uci: m.uci,
  arrows: m.arrows,
  circles: m.circles,
  comment: m.comment,
  ord,
});

/** Inserts the moves in graph order (their `ord` follows it); returns their ids by move key. */
async function insertMoves(
  tx: Executor,
  repertoireId: string,
  added: readonly RepertoireMove[],
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  if (added.length === 0) return ids;
  let ord = await nextMoveOrd(tx, repertoireId);
  for (const batch of batches(added)) {
    const rows = await tx
      .insert(repertoireMoves)
      .values(batch.map((m, i) => moveRow(repertoireId, m, ord + i)))
      .returning({
        id: repertoireMoves.id,
        fromKey: repertoireMoves.fromKey,
        san: repertoireMoves.san,
      });
    for (const row of idRowsSchema.parse(rows))
      ids.set(moveKey(row.fromKey, row.san), row.id);
    ord += batch.length;
  }
  return ids;
}

async function updateMoves(
  tx: Executor,
  repertoireId: string,
  changed: readonly RepertoireMove[],
): Promise<void> {
  for (const m of changed)
    await tx
      .update(repertoireMoves)
      .set({ arrows: m.arrows, circles: m.circles, comment: m.comment })
      .where(
        and(
          ofRepertoire(repertoireId),
          eq(repertoireMoves.fromKey, m.from),
          eq(repertoireMoves.san, m.san),
        ),
      );
}

async function insertLinks(
  tx: Executor,
  repertoireId: string,
  links: readonly MoveLink[],
  ids: ReadonlyMap<string, string>,
): Promise<void> {
  const rows = links.flatMap((l) => {
    const moveId = ids.get(l.moveKey);
    return moveId === undefined
      ? []
      : [{ moveId, repertoireId, chapterId: l.chapterId }];
  });
  for (const batch of batches(rows))
    await tx.insert(moveChapters).values(batch);
}

const linksOf = (moves: readonly RepertoireMove[]): MoveLink[] =>
  moves.flatMap((m) =>
    m.chapters.map((chapterId) => ({
      moveKey: moveKey(m.from, m.san),
      chapterId,
    })),
  );

/**
 * Deletes first (moves, then the links of kept moves, then chapters, whose
 * links cascade), then inserts chapters before the moves and links that
 * point at them, so one save can add a repertoire's first chapter with its
 * first move (R-111).
 */
export async function writeChanges(
  tx: Executor,
  repertoireId: string,
  changes: GraphChanges,
): Promise<void> {
  await deleteMoves(tx, repertoireId, changes.removedMoveKeys);
  await deleteLinks(tx, repertoireId, changes.removedLinks);
  await deleteChapters(tx, repertoireId, changes.removedChapterIds);
  await insertChapters(tx, repertoireId, changes.addedChapters);
  await updateChapters(tx, repertoireId, changes.changedChapters);
  const newIds = await insertMoves(tx, repertoireId, changes.addedMoves);
  await updateMoves(tx, repertoireId, changes.annotatedMoves);
  const keptIds = await moveIds(
    tx,
    repertoireId,
    changes.addedLinks.map((l) => l.moveKey),
  );
  await insertLinks(
    tx,
    repertoireId,
    [...linksOf(changes.addedMoves), ...changes.addedLinks],
    new Map([...newIds, ...keptIds]),
  );
}
