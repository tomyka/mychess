import {
  addChapter,
  addMove,
  editComment,
  marksInputSchema,
  removeChapter,
  removeMove,
  renameChapter,
  setMarks,
  START_KEY,
  type EditRefusal,
  type RepertoireGraph,
  type Result,
} from '@mychess/chess';
import { chapterNameSchema, commentSchema } from '@mychess/domain';
import { z } from 'zod';

const chapterId = z.string().min(1).max(20);
const from = z.string().min(1).max(100);
const san = z.string().min(1).max(10);

/** One builder edit, as the client sends it (parsed at the edge). */
const editOpSchema = z.discriminatedUnion('kind', [
  // A null chapter is the first move of a repertoire without chapters (R-111).
  z.object({
    kind: z.literal('addMove'),
    chapterId: chapterId.nullable(),
    from,
    san,
  }),
  z.object({ kind: z.literal('removeMove'), chapterId, from, san }),
  z.object({
    kind: z.literal('setMarks'),
    chapterId,
    from,
    san,
    marks: marksInputSchema,
  }),
  z.object({
    kind: z.literal('editComment'),
    moveKey: z.string().min(1).max(120),
    comment: commentSchema,
  }),
  z.object({ kind: z.literal('addChapter') }),
  z.object({
    kind: z.literal('renameChapter'),
    chapterId,
    name: chapterNameSchema,
  }),
  z.object({ kind: z.literal('removeChapter'), chapterId }),
]);
export type EditOp = z.infer<typeof editOpSchema>;

/** A builder edit with the repertoire and the version the client holds. */
export const editRequestSchema = z.object({
  repertoireId: z.uuid(),
  version: z.number().int().positive(),
  op: editOpSchema,
});

type EditResult = Result<RepertoireGraph, EditRefusal>;

/**
 * Adds a move to a chapter; with no chapter, in a repertoire that has none,
 * it starts chapter one from the standard start and adds the move to it in
 * the same edit, so it is saved once (R-111).
 */
function addTo(
  graph: RepertoireGraph,
  chapterId: string | null,
  fromKey: string,
  san: string,
): EditResult {
  if (chapterId !== null) return addMove(graph, chapterId, fromKey, san);
  if (graph.chapters.length > 0)
    return { ok: false, refusal: { reason: 'repertoire.unknownChapter' } };
  const started = addChapter(graph, START_KEY);
  return addMove(started.graph, started.chapterId, fromKey, san);
}

/** The chess function that decides each edit (the action only routes to it). */
export function applyEdit(graph: RepertoireGraph, op: EditOp): EditResult {
  switch (op.kind) {
    case 'addMove':
      return addTo(graph, op.chapterId, op.from, op.san);
    case 'removeMove':
      return removeMove(graph, op.chapterId, op.from, op.san);
    case 'setMarks':
      return setMarks(
        graph,
        op.chapterId,
        { from: op.from, san: op.san },
        op.marks,
      );
    case 'editComment':
      return editComment(graph, op.moveKey, op.comment);
    case 'addChapter':
      return { ok: true, value: addChapter(graph, START_KEY).graph };
    case 'renameChapter':
      return renameChapter(graph, op.chapterId, op.name);
    case 'removeChapter':
      return removeChapter(graph, op.chapterId);
  }
}
