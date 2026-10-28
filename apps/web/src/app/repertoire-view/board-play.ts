// What a move played on the board means for the repertoire page: which
// legal moves join two squares, and whether the chapter has it.
import {
  chapterChildren,
  type BoardMove,
  type Marks,
  type RepertoireGraph,
  type RepertoireMove,
} from '@mychess/chess';

/** The legal moves from `orig` to `dest`: one, or four promotions. */
export function movesBetween(
  legal: readonly BoardMove[],
  orig: string,
  dest: string,
): BoardMove[] {
  return legal.filter((m) => m.orig === orig && m.dest === dest);
}

/** The chapter's move `san` from position `key`, if the chapter has it. */
export function childBySan(
  graph: RepertoireGraph,
  chapterId: string,
  key: string,
  san: string,
): RepertoireMove | undefined {
  return chapterChildren(graph)(chapterId)(key).find((m) => m.san === san);
}

/** A chapter and the moves from its root. */
export interface Place {
  readonly chapterId: string | null;
  readonly path: readonly RepertoireMove[];
}

/** Where the screen goes after a move is added: on to it, in its chapter. */
export function placeAdded(
  graph: RepertoireGraph,
  at: Place,
  played: { readonly from: string; readonly san: string },
): Place {
  const { from, san } = played;
  const { chapterId, path } = at;
  // A first move started the only chapter (R-111).
  const chapter = chapterId ?? graph.chapters.at(-1)?.id ?? null;
  const added = graph.moves.find(
    (m) =>
      m.from === from &&
      m.san === san &&
      chapter !== null &&
      m.chapters.includes(chapter),
  );
  return {
    chapterId: chapter,
    path: added === undefined ? path : [...path, added],
  };
}

/** Whether draw mode's tap from `from` to `to` left an arrow or circle there. */
export function markChange(
  marks: Marks,
  from: string,
  to: string,
): { kind: 'arrow' | 'circle'; added: boolean } {
  if (from === to)
    return {
      kind: 'circle',
      added: marks.circles.some((c) => c.square === from),
    };
  return {
    kind: 'arrow',
    added: marks.arrows.some((a) => a.from === from && a.to === to),
  };
}
