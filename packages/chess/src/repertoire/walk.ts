/**
 * Every walk over a chapter of the move graph (ADR-0003): its lines, its main
 * line, and the walk that takes each move once (the daily queue's line order,
 * PGN export's variations). A chapter is a grouping over the repertoire's
 * moves, so a walk follows only the moves the chapter holds, and children in
 * insertion order: the first-inserted move at a position is its main move.
 *
 * One repetition rule holds for every walk: a move onto a position already on
 * the current path is that path's last move. It is kept, so no walk loses a
 * move, and it is not followed, so no walk loops. The walk that takes each
 * move once also stops at a position it has already walked from (a
 * transposition), so it costs the chapter's size, not its number of lines.
 */
import { chapterOf, type RepertoireGraph, type RepertoireMove } from './graph';

/** A move of the walk that takes each move once, with the moves it continues into. */
export interface WalkNode {
  readonly move: RepertoireMove;
  /** Empty when the move lands on a position the walk already walked from. */
  readonly next: readonly WalkNode[];
}

/** The walks over one chapter. */
export interface ChapterWalk {
  /**
   * Every line from the root to a leaf, or to a move back onto the line. It
   * enumerates every path, so a chapter with many transpositions yields
   * exponentially many lines; there is no cap yet.
   */
  lines(): RepertoireMove[][];
  /** The first child at each position: `lines()[0]`, walked in linear time. */
  mainLine(): RepertoireMove[];
  /**
   * Each move the root reaches once, depth first: the first child's whole
   * subtree before the next child. A move into a position already walked
   * from has no `next`.
   */
  tree(): WalkNode[];
  /** `tree()` in order (each move before its `next`): the chapter's line order. */
  moves(): RepertoireMove[];
}

/** The chapter's children of `key`, in insertion order. */
type Children = (key: string) => readonly RepertoireMove[];

const NO_WALK: ChapterWalk = {
  lines: () => [],
  mainLine: () => [],
  tree: () => [],
  moves: () => [],
};

function indexByPosition(
  graph: RepertoireGraph,
): ReadonlyMap<string, readonly RepertoireMove[]> {
  const index = new Map<string, RepertoireMove[]>();
  for (const move of graph.moves) {
    const siblings = index.get(move.from);
    if (siblings === undefined) index.set(move.from, [move]);
    else siblings.push(move);
  }
  return index;
}

/** A chapter's children: the repertoire's moves from a position, filtered by chapter. */
function childrenIn(
  index: ReadonlyMap<string, readonly RepertoireMove[]>,
  chapterId: string,
): Children {
  return (key) =>
    (index.get(key) ?? []).filter((m) => m.chapters.includes(chapterId));
}

/** A line being extended, or a finished one when `done`. */
interface Path {
  readonly key: string;
  readonly moves: RepertoireMove[];
  readonly onPath: ReadonlySet<string>;
  readonly done: boolean;
}

function extend(path: Path, move: RepertoireMove): Path {
  return {
    key: move.to,
    moves: [...path.moves, move],
    onPath: new Set([...path.onPath, move.to]),
    done: path.onPath.has(move.to),
  };
}

function linesFrom(rootKey: string, children: Children): RepertoireMove[][] {
  const out: RepertoireMove[][] = [];
  const stack: Path[] = [
    { key: rootKey, moves: [], onPath: new Set([rootKey]), done: false },
  ];
  for (let path = stack.pop(); path !== undefined; path = stack.pop()) {
    const next = path.done ? [] : children(path.key);
    if (next.length === 0 && path.moves.length > 0) out.push(path.moves);
    for (const move of [...next].reverse()) stack.push(extend(path, move));
  }
  return out;
}

function mainLineFrom(rootKey: string, children: Children): RepertoireMove[] {
  const line: RepertoireMove[] = [];
  const onPath = new Set([rootKey]);
  for (let key = rootKey; ;) {
    const [first] = children(key);
    if (first === undefined) return line;
    line.push(first);
    if (onPath.has(first.to)) return line;
    onPath.add(first.to);
    key = first.to;
  }
}

interface Walked {
  readonly tree: WalkNode[];
  readonly moves: RepertoireMove[];
}

/** A move waiting to be walked, and the list its node joins. */
interface Pending {
  readonly move: RepertoireMove;
  readonly into: WalkNode[];
}

const pending = (moves: readonly RepertoireMove[], into: WalkNode[]) =>
  moves.map((move): Pending => ({ move, into })).reverse();

/**
 * Depth first with an explicit stack, so a long line cannot overflow the call
 * stack. A position is walked from once: the root, then each position the
 * first move into it reaches.
 */
function walkOnce(rootKey: string, children: Children): Walked {
  const tree: WalkNode[] = [];
  const moves: RepertoireMove[] = [];
  const walked = new Set([rootKey]);
  const stack = pending(children(rootKey), tree);
  for (let top = stack.pop(); top !== undefined; top = stack.pop()) {
    const next: WalkNode[] = [];
    top.into.push({ move: top.move, next });
    moves.push(top.move);
    if (!walked.has(top.move.to)) {
      walked.add(top.move.to);
      stack.push(...pending(children(top.move.to), next));
    }
  }
  return { tree, moves };
}

function walkFrom(rootKey: string, children: Children): ChapterWalk {
  let walked: Walked | undefined;
  const once = (): Walked => (walked ??= walkOnce(rootKey, children));
  return {
    lines: () => linesFrom(rootKey, children),
    mainLine: () => mainLineFrom(rootKey, children),
    tree: () => once().tree,
    moves: () => once().moves,
  };
}

/**
 * The walks of each chapter of `graph`. The position index is built once for
 * the whole repertoire, so walking every chapter costs about the graph's size.
 * An unknown chapter has no moves.
 */
export function chapterWalks(
  graph: RepertoireGraph,
): (chapterId: string) => ChapterWalk {
  const index = indexByPosition(graph);
  return (chapterId) => {
    const chapter = chapterOf(graph, chapterId);
    if (chapter === undefined) return NO_WALK;
    return walkFrom(chapter.rootKey, childrenIn(index, chapterId));
  };
}

/** Every line of a chapter from its root (see `ChapterWalk.lines`). */
export function lines(
  graph: RepertoireGraph,
  chapterId: string,
): RepertoireMove[][] {
  return chapterWalks(graph)(chapterId).lines();
}

/** A chapter's main line (see `ChapterWalk.mainLine`). */
export function mainLine(
  graph: RepertoireGraph,
  chapterId: string,
): RepertoireMove[] {
  return chapterWalks(graph)(chapterId).mainLine();
}
