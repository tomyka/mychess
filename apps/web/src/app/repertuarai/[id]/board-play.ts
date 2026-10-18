// What a move played on the board means for the repertoire page: which
// legal moves join two squares, and whether the chapter has it.
import {
  chapterChildren,
  type BoardMove,
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

/**
 * The number shown before the move `ply` half-moves after a chapter's root:
 * `6.` for White, `6...` for Black. A position key has no move counter, so
 * the count starts from the root (move 1).
 */
export function moveNumber(ply: number, whiteFirst: boolean): string {
  const half = ply + (whiteFirst ? 0 : 1);
  const number = String(Math.floor(half / 2) + 1);
  return half % 2 === 0 ? `${number}.` : `${number}...`;
}
