/**
 * What tells apart chapters of one repertoire that would show the same title
 * (R-158): each chapter's opening ECO code and the first move of its main
 * line where it parts from the others, as in "Karo-Kano gynyba (B12, 3. e5)".
 */
import { classify } from '../openings/classify';
import { sideToMove, START_KEY } from '../position-key';
import {
  moveKey,
  type Chapter,
  type RepertoireGraph,
  type RepertoireMove,
} from './graph';
import { chapterWalks } from './walk';

/** The first move of a chapter's main line that no other chapter's shares. */
export interface DistinctMove {
  /** Half-moves after the chapter's root, for `moveNumber`. */
  readonly ply: number;
  readonly san: string;
  /** Whether White moves first from the chapter's root, for `moveNumber`. */
  readonly whiteFirst: boolean;
}

export interface ChapterDistinction {
  /** The opening's ECO code, or null when the chapter has none. */
  readonly eco: string | null;
  /** Null when the main line is a prefix of, or equal to, another's. */
  readonly firstMove: DistinctMove | null;
}

/**
 * The chapter's ECO code: its taxonomy name's, else the classification of its
 * main line when it starts from the standard start, else none.
 */
function ecoOf(
  chapter: Chapter,
  line: readonly RepertoireMove[],
): string | null {
  if (chapter.nameSource.kind === 'eco') return chapter.nameSource.eco;
  if (chapter.rootKey !== START_KEY) return null;
  return classify(line.map((m) => m.san))?.code ?? null;
}

/** How many leading move keys `a` and `b` share. */
function commonPrefix(a: readonly string[], b: readonly string[]): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/** A chapter with its main line and that line's move keys. */
interface Lined {
  readonly chapter: Chapter;
  readonly line: readonly RepertoireMove[];
  readonly keys: readonly string[];
}

/**
 * The move of `own`'s main line just past its longest common prefix with any
 * other chapter's (the deepest divergence), or null when the whole line is
 * shared with one of them.
 */
function firstMoveOf(
  own: Lined,
  others: readonly Lined[],
): DistinctMove | null {
  const ply = Math.max(0, ...others.map((o) => commonPrefix(own.keys, o.keys)));
  const move = own.line[ply];
  if (move === undefined) return null;
  const whiteFirst = sideToMove(own.chapter.rootKey) === 'w';
  return { ply, san: move.san, whiteFirst };
}

/** Each chapter's ECO code and distinct first move, by chapter id. */
export function chapterDistinctions(
  graph: RepertoireGraph,
): ReadonlyMap<string, ChapterDistinction> {
  const walks = chapterWalks(graph);
  const lined = graph.chapters.map((chapter): Lined => {
    const line = walks(chapter.id).mainLine();
    const keys = line.map((m) => moveKey(m.from, m.san));
    return { chapter, line, keys };
  });
  return new Map(
    lined.map((own) => {
      const others = lined.filter((o) => o !== own);
      const distinction: ChapterDistinction = {
        eco: ecoOf(own.chapter, own.line),
        firstMove: firstMoveOf(own, others),
      };
      return [own.chapter.id, distinction] as const;
    }),
  );
}
