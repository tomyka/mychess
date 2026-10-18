/** What a repertoire holds, counted for the import summary (R-64). */
import type { RepertoireGraph } from './graph';
import { chapterChildren, chapterWalks } from './walk';

/** What an import or a repertoire holds, as the import summary shows it (R-64). */
export interface RepertoireSummary {
  readonly chapters: number;
  /** Line ends: moves after which their chapter has no further move. */
  readonly lines: number;
  readonly moves: number;
  /** Distinct positions: the chapter roots and every move's target. */
  readonly positions: number;
  /** Positions two or more moves reach. */
  readonly transpositions: number;
}

/** How many line ends the chapters have, each chapter walked once. */
function lineEnds(graph: RepertoireGraph): number {
  const walks = chapterWalks(graph);
  const childrenOf = chapterChildren(graph);
  return graph.chapters.reduce((sum, chapter) => {
    const children = childrenOf(chapter.id);
    const ends = walks(chapter.id)
      .moves()
      .filter((m) => children(m.to).length === 0);
    return sum + ends.length;
  }, 0);
}

/** Linear in the repertoire's size (it never enumerates every line). */
export function summarize(graph: RepertoireGraph): RepertoireSummary {
  const positions = new Set(graph.chapters.map((c) => c.rootKey));
  const reaching = new Map<string, number>();
  for (const move of graph.moves) {
    positions.add(move.to);
    reaching.set(move.to, (reaching.get(move.to) ?? 0) + 1);
  }
  return {
    chapters: graph.chapters.length,
    lines: lineEnds(graph),
    moves: graph.moves.length,
    positions: positions.size,
    transpositions: [...reaching.values()].filter((n) => n > 1).length,
  };
}
