import {
  annotatedSan,
  chapterOf,
  moveNumber,
  sideToMove,
  type RepertoireGraph,
  type RepertoireMove,
} from '@mychess/chess';

/** "6... a6": the current move with its number, as the move list writes it. */
export function moveLabel(
  graph: RepertoireGraph,
  chapterId: string,
  path: readonly RepertoireMove[],
  move: RepertoireMove,
): string {
  const root = chapterOf(graph, chapterId)?.rootKey ?? move.from;
  const number = moveNumber(path.length - 1, sideToMove(root) === 'w');
  return `${number} ${annotatedSan(move.san, move.nags)}`;
}
