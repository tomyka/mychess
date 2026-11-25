/**
 * How a chapter is named from its moves. R-63: an imported game is named
 * from the opening taxonomy first: the named lines of
 * lichess-org/chess-openings (R-216). R-104: a chapter built on the board is named the same way
 * as its moves grow, and is "Chapter N" only while its line is too short to
 * classify. A name its owner typed, or one a PGN header
 * gave, is never replaced.
 */
import { classifyKeys, ecoName } from '../openings/classify';
import type { EcoEntry } from '../openings/data/eco';
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
 * The named line a chapter's main line reaches (R-216), read from the
 * graph's position keys; null when the chapter does not start from the
 * standard start or reaches none.
 */
export function chapterOpening(
  chapter: Chapter,
  mainLine: readonly RepertoireMove[],
): EcoEntry | null {
  if (chapter.rootKey !== START_KEY) return null;
  return classifyKeys(mainLine.map((move) => move.to));
}

/**
 * `chapter` named after the deepest named line its main line reaches from
 * the standard start; the same chapter when there is none or its stored
 * code is already that line's.
 */
export function taxonomyNamed(
  chapter: Chapter,
  mainLine: readonly RepertoireMove[],
): Chapter {
  const entry = chapterOpening(chapter, mainLine);
  return entry === null ? chapter : withCode(chapter, entry.code);
}

/** `chapter` named by ECO `code`; the same chapter when it already is. */
function withCode(chapter: Chapter, code: string): Chapter {
  const source = chapter.nameSource;
  if (source.kind === 'eco' && source.eco === code) return chapter;
  return { ...chapter, nameSource: { kind: 'eco', eco: code } };
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
  const entry = chapterOpening(chapter, mainLine);
  if (entry !== null) return withCode(chapter, entry.code);
  if (kind === 'index') return chapter;
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

/**
 * Each taxonomy-named chapter's opening name, by chapter id:
 * the named line its main line reaches, else its stored code's family name.
 * Derived whenever titles are built, so nothing is stored (R-216).
 */
export function taxonomyNames(
  graph: RepertoireGraph,
): ReadonlyMap<string, string> {
  const walks = chapterWalks(graph);
  return new Map(
    graph.chapters.flatMap((chapter) => {
      const source = chapter.nameSource;
      if (source.kind !== 'eco') return [];
      const entry = chapterOpening(chapter, walks(chapter.id).mainLine());
      const name = entry === null ? ecoName(source.eco) : entry.name;
      return [[chapter.id, name] as const];
    }),
  );
}
