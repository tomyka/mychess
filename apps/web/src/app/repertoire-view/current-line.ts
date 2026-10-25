import {
  lines,
  moveKey,
  type RepertoireGraph,
  type RepertoireMove,
} from '@mychess/chess';

const keyOf = (move: RepertoireMove): string => moveKey(move.from, move.san);

/** Does `line` start with `path`? */
const starts = (
  line: readonly RepertoireMove[],
  path: readonly RepertoireMove[],
): boolean =>
  path.length <= line.length &&
  path.every((move, i) => {
    const at = line[i];
    return at !== undefined && keyOf(at) === keyOf(move);
  });

/**
 * The line a view is on, as "I know this" names it (R-58, R-147): the index
 * in `lines(graph, chapterId)` of the first line that starts with `path`.
 * Null at the chapter root, where no line is chosen yet, and for a path no
 * line of the chapter starts.
 */
export function currentLineIndex(
  graph: RepertoireGraph,
  chapterId: string,
  path: readonly RepertoireMove[],
): number | null {
  if (path.length === 0) return null;
  const index = lines(graph, chapterId).findIndex((line) => starts(line, path));
  return index === -1 ? null : index;
}
