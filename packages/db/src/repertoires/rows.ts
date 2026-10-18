/** The repertoire rows as zod parses them (parse at the edge), and the graph they make. */
import {
  arrowSchema,
  chapterNameSourceSchema,
  circleSchema,
  type RepertoireGraph,
  type Side,
} from '@mychess/chess';
import { z } from 'zod';

export const chapterRowsSchema = z.array(
  z.object({
    chapterId: z.string().min(1),
    rootKey: z.string().min(1),
    nameSource: chapterNameSourceSchema,
    intro: z.string().nullable(),
  }),
);

// Imported comments may be longer than a typed one (decision 4): no max here.
export const moveRowsSchema = z.array(
  z.object({
    id: z.uuid(),
    fromKey: z.string().min(1),
    san: z.string().min(1),
    toKey: z.string().min(1),
    uci: z.string().min(4),
    arrows: z.array(arrowSchema),
    circles: z.array(circleSchema),
    comment: z.string().nullable(),
  }),
);

export const linkRowsSchema = z.array(
  z.object({ moveId: z.uuid(), chapterId: z.string().min(1) }),
);

type ChapterRow = z.infer<typeof chapterRowsSchema>[number];
type MoveRow = z.infer<typeof moveRowsSchema>[number];
type LinkRow = z.infer<typeof linkRowsSchema>[number];

/** The chapter ids each move is linked to, by move id. */
function chaptersByMove(links: readonly LinkRow[]): Map<string, string[]> {
  const held = new Map<string, string[]>();
  for (const link of links)
    held.set(link.moveId, [...(held.get(link.moveId) ?? []), link.chapterId]);
  return held;
}

/** The graph the rows hold: chapters and moves in `ord` order; a move's chapters in chapter order. */
export function graphOf(
  side: Side,
  chapterRows: readonly ChapterRow[],
  moveRows: readonly MoveRow[],
  links: readonly LinkRow[],
): RepertoireGraph {
  const place = new Map(chapterRows.map((c, i) => [c.chapterId, i]));
  const held = chaptersByMove(links);
  const inOrder = (ids: readonly string[]) =>
    ids.toSorted((a, b) => (place.get(a) ?? 0) - (place.get(b) ?? 0));
  return {
    side,
    chapters: chapterRows.map((c) => ({
      id: c.chapterId,
      rootKey: c.rootKey,
      intro: c.intro,
      nameSource: c.nameSource,
    })),
    moves: moveRows.map((m) => ({
      from: m.fromKey,
      to: m.toKey,
      san: m.san,
      uci: m.uci,
      arrows: m.arrows,
      circles: m.circles,
      comment: m.comment,
      chapters: inOrder(held.get(m.id) ?? []),
    })),
  };
}
