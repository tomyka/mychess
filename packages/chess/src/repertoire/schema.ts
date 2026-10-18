/** The repertoire's shapes as zod schemas, for parsing at the edges (db rows, edit requests). */
import { z } from 'zod';

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
