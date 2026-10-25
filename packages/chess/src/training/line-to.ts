/**
 * The line so far to a move (R-143): the chapter walk's path from the
 * chapter's root to the move, in the first chapter that holds it. After a
 * transposition that is the path the walk took first (as chapterPlies).
 */
import {
  moveKey,
  type RepertoireGraph,
  type RepertoireMove,
} from '../repertoire/graph';
import { chapterWalks, type WalkedMove } from '../repertoire/walk';

export interface LineTo {
  readonly chapterId: string;
  readonly rootKey: string;
  /** From the root; the move asked about is last. */
  readonly moves: readonly RepertoireMove[];
}

interface Frame {
  readonly walked: WalkedMove;
  readonly path: readonly RepertoireMove[];
}

function pathIn(
  tree: readonly WalkedMove[],
  key: string,
): RepertoireMove[] | undefined {
  const stack: Frame[] = tree.map((walked) => ({ walked, path: [] })).reverse();
  for (let top = stack.pop(); top !== undefined; top = stack.pop()) {
    const { move, next } = top.walked;
    const path = [...top.path, move];
    if (moveKey(move.from, move.san) === key) return path;
    for (const child of [...next].reverse())
      stack.push({ walked: child, path });
  }
  return undefined;
}

export function lineTo(
  graph: RepertoireGraph,
  key: string,
): LineTo | undefined {
  const walks = chapterWalks(graph);
  for (const chapter of graph.chapters) {
    const moves = pathIn(walks(chapter.id).tree(), key);
    if (moves !== undefined)
      return { chapterId: chapter.id, rootKey: chapter.rootKey, moves };
  }
  return undefined;
}
