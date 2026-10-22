/** The repertoire's shapes as zod schemas, for parsing at the edges (db rows, edit requests). */
import { z } from 'zod';
import type { MoveChanges } from './changes';
import type { RepertoireGraph } from './graph';

export const SIDES = ['white', 'black'] as const;
export const sideSchema = z.enum(SIDES);
const markColorSchema = z.enum(['G', 'R', 'Y', 'B']);

const square = z.string().regex(/^[a-h][1-8]$/);

export const arrowSchema = z.object({
  from: square,
  to: square,
  color: markColorSchema,
});
export const circleSchema = z.object({ square, color: markColorSchema });

/** The most arrows or circles one builder edit may draw on a move. */
const MARKS_MAX = 64;

export const marksInputSchema = z.object({
  arrows: z.array(arrowSchema).max(MARKS_MAX),
  circles: z.array(circleSchema).max(MARKS_MAX),
});

export const chapterNameSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('custom'), name: z.string() }),
  z.object({ kind: z.literal('eco'), eco: z.string() }),
  z.object({ kind: z.literal('header'), name: z.string() }),
  z.object({ kind: z.literal('index'), number: z.number().int().positive() }),
]);

const chapterSchema = z.object({
  id: z.string().min(1),
  rootKey: z.string().min(1),
  intro: z.string().nullable(),
  nameSource: chapterNameSourceSchema,
});

const moveSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  san: z.string().min(1),
  uci: z.string().min(1),
  arrows: z.array(arrowSchema),
  circles: z.array(circleSchema),
  comment: z.string().nullable(),
  chapters: z.array(z.string().min(1)),
});

const moveLinkSchema = z.object({
  moveKey: z.string().min(1),
  chapterId: z.string().min(1),
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** A row stored before the rename counts changed comments as `annotated`. */
const renameAnnotated = (value: unknown): unknown => {
  if (!isRecord(value) || 'commentsChanged' in value) return value;
  const { annotated, ...rest } = value;
  return { ...rest, commentsChanged: annotated };
};

/**
 * What one edit changed for players, for parsing one stored as JSON
 * (`repertoire_changes.changes`); reads old rows that say `annotated`.
 */
export const moveChangesSchema = z.preprocess(
  renameAnnotated,
  z.object({
    added: z.array(moveLinkSchema),
    removed: z.array(moveLinkSchema),
    commentsChanged: z.number().int().nonnegative(),
  }),
) satisfies z.ZodType<MoveChanges>;

/** A whole repertoire graph, for parsing one stored as JSON (a fork offer's snapshot). */
export const repertoireGraphSchema = z.object({
  side: sideSchema,
  chapters: z.array(chapterSchema),
  moves: z.array(moveSchema),
}) satisfies z.ZodType<RepertoireGraph>;
