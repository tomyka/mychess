/**
 * How a chapter is named from its moves. R-63: an imported game is named
 * from the šachmatai.lt taxonomy first. R-104: a chapter built on the board
 * is named the same way as its moves grow, and is "Chapter N" only while its
 * line is too short to classify. A name its owner typed, or one a PGN header
 * gave, is never replaced.
 */
import { classify } from '../openings/classify';
import { START_KEY } from '../position-key';
import {
  chapterOf,
  nextChapterNumber,
  type Chapter,
  type RepertoireGraph,
  type RepertoireMove,
} from './graph';
import { chapterWalks } from './walk';

/**
 * `chapter` named after the deepest ECO position its main line passes
 * through from the standard start, or unchanged when there is none.
 */
export function taxonomyNamed(
  chapter: Chapter,
  mainLine: readonly RepertoireMove[],
): Chapter {
  if (chapter.rootKey !== START_KEY) return chapter;
  const entry = classify(mainLine.map((m) => m.san));
  if (entry === null) return chapter;
  return { ...chapter, nameSource: { kind: 'eco', eco: entry.code } };
}

/**
 * The name a chapter takes after its moves changed (R-104): the taxonomy's
 * when its main line classifies, otherwise its number, or a number past
 * every other chapter of `chapters` (its repertoire's) when it had a
 * taxonomy name. A custom or header name stays.
 */
export function namedByMoves(
  chapter: Chapter,
  mainLine: readonly RepertoireMove[],
  chapters: readonly Chapter[],
): Chapter {
  const { kind } = chapter.nameSource;
  if (kind === 'custom' || kind === 'header') return chapter;
  const named = taxonomyNamed(chapter, mainLine);
  if (named !== chapter || kind === 'index') return named;
  const others = chapters.filter((c) => c.id !== chapter.id);
  const number = nextChapterNumber(others);
  return { ...chapter, nameSource: { kind: 'index', number } };
}

/** `graph` with one chapter renamed by its moves (see `namedByMoves`). */
export function renamedByMoves(
  graph: RepertoireGraph,
  chapterId: string,
): RepertoireGraph {
  const chapter = chapterOf(graph, chapterId);
  if (chapter === undefined) return graph;
  const mainLine = chapterWalks(graph)(chapterId).mainLine();
  const named = namedByMoves(chapter, mainLine, graph.chapters);
  if (named === chapter) return graph;
  const chapters = graph.chapters.map((c) => (c === chapter ? named : c));
  return { ...graph, chapters };
}
