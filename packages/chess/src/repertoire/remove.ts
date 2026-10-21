/**
 * What removing a move takes out of a chapter. Kept apart from `edit.ts`
 * (which also renames the chapter, R-104) so the browser can preview a
 * removal without loading the ECO tables the naming needs (S3 decision 17).
 */
import {
  chapterOf,
  type Chapter,
  type RepertoireGraph,
  type RepertoireMove,
} from './graph';
import { chapterWalks } from './walk';

/** Whether `move` is `san` played from `fromKey`. */
export const same = (
  move: RepertoireMove,
  fromKey: string,
  san: string,
): boolean => move.from === fromKey && move.san === san;

/** The moves a chapter's root reaches. */
export const walkedMoves = (
  graph: RepertoireGraph,
  chapter: Chapter,
): readonly RepertoireMove[] => chapterWalks(graph)(chapter.id).moves();

/** `move` no longer in the chapter `chapterId`. */
export function withoutChapter(
  move: RepertoireMove,
  chapterId: string,
): RepertoireMove {
  return { ...move, chapters: move.chapters.filter((c) => c !== chapterId) };
}

/** Moves of a chapter its root no longer reaches leave the chapter. */
function prune(graph: RepertoireGraph, chapter: Chapter): RepertoireGraph {
  const kept = new Set(walkedMoves(graph, chapter));
  const moves = graph.moves.map((m) =>
    kept.has(m) ? m : withoutChapter(m, chapter.id),
  );
  return { ...graph, moves: moves.filter((m) => m.chapters.length > 0) };
}

/**
 * `graph` without `san` from `fromKey` in `chapter`, and without every move
 * of the chapter that only it reached. A move still reachable another way (a
 * transposition) or used by another chapter stays. Names are left as they
 * were: `removeMove` renames.
 */
export function withoutMove(
  graph: RepertoireGraph,
  chapter: Chapter,
  fromKey: string,
  san: string,
): RepertoireGraph {
  const moves = graph.moves.map((m) =>
    same(m, fromKey, san) ? withoutChapter(m, chapter.id) : m,
  );
  return prune({ ...graph, moves }, chapter);
}

const movesIn = (graph: RepertoireGraph, chapterId: string): number =>
  graph.moves.filter((m) => m.chapters.includes(chapterId)).length;

/**
 * How many of a chapter's moves after `san` from `fromKey` removing it takes
 * along: those only it reached. Zero for an unknown chapter or a move the
 * chapter does not have.
 */
export function removalCount(
  graph: RepertoireGraph,
  chapterId: string,
  fromKey: string,
  san: string,
): number {
  const chapter = chapterOf(graph, chapterId);
  if (chapter === undefined) return 0;
  const after = withoutMove(graph, chapter, fromKey, san);
  const gone = movesIn(graph, chapterId) - movesIn(after, chapterId);
  return Math.max(gone - 1, 0);
}
