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
import { chapterWalks } from '../repertoire/walk';

export interface LineTo {
  readonly chapterId: string;
  readonly rootKey: string;
  /** From the root; the move asked about is last. */
  readonly moves: readonly RepertoireMove[];
}

/**
 * The line so far to every move of the graph, by move key: the first walk
 * path, chapters in order, that holds the move, cut after it. Built once, it
 * answers every move of a repertoire.
 */
export function linesTo(graph: RepertoireGraph): ReadonlyMap<string, LineTo> {
  const out = new Map<string, LineTo>();
  const walks = chapterWalks(graph);
  for (const { id: chapterId, rootKey } of graph.chapters) {
    for (const path of walks(chapterId).paths()) {
      path.forEach((move, at) => {
        const key = moveKey(move.from, move.san);
        if (!out.has(key))
          out.set(key, { chapterId, rootKey, moves: path.slice(0, at + 1) });
      });
    }
  }
  return out;
}

export function lineTo(
  graph: RepertoireGraph,
  key: string,
): LineTo | undefined {
  return linesTo(graph).get(key);
}
