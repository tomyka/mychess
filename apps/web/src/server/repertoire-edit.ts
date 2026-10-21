import { marksInputSchema, type EditOp } from '@mychess/chess';
import { chapterNameSchema, commentSchema } from '@mychess/domain';
import { z } from 'zod';

const chapterId = z.string().min(1).max(20);
const from = z.string().min(1).max(100);
const san = z.string().min(1).max(10);

/**
 * One builder edit, as the client sends it (parsed at the edge); chess's
 * `applyEdit` decides it.
 */
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
]) satisfies z.ZodType<EditOp>;

/**
 * The catalogue key a malformed edit request reads as, unless its first
 * issue is one the domain names (a chapter name or a comment).
 */
export const INVALID_EDIT = 'repertoire.invalidEdit';

/** A builder edit with the repertoire and the version the client holds. */
export const editRequestSchema = z.object({
  repertoireId: z.uuid(),
  version: z.number().int().positive(),
  op: editOpSchema,
});
