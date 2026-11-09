/**
 * Adding an imported repertoire to an existing one of the same side (R-101):
 * each imported chapter becomes a new chapter, and its moves go through the
 * existing repertoire's own move store, so positions merge (a move already
 * there gains the chapter) and the player keeps one answer per position
 * (R-54). The existing repertoire wins: a shared move keeps its comment,
 * NAGs and marks, and gets the imported ones only where it has none. A game
 * that adds no move adds no chapter, but its comments and NAGs still go to
 * the moves that have none (R-176); its marks do not.
 */
import {
  secondAnswer,
  type ImportedRepertoire,
  type Skipped,
} from '../pgn/import-pgn';
import { sideToMove } from '../position-key';
import type { Result } from '../result';
import {
  moveKey,
  nextChapterId,
  nextChapterNumber,
  type Chapter,
  type RepertoireGraph,
  type RepertoireMove,
  type Side,
} from './graph';
import { RepertoireMoves, type DraftMove } from './moves';
import { namedByMoves } from './naming';
import { chapterChildren, chapterWalks, type Children } from './walk';

export interface MergedRepertoire {
  readonly graph: RepertoireGraph;
  /**
   * The imported moves the existing repertoire already answers differently
   * (R-54), each left out with every move only it reached. The import's own
   * `skipped` is not repeated here.
   */
  readonly skipped: readonly Skipped[];
  /** What the merge adds, or why there is nothing to import (R-115). */
  readonly added: Result<MergeAddition, NothingToAdd>;
}

/** What a merge adds to the repertoire it was merged into. */
export interface MergeAddition {
  readonly chapters: number;
  readonly moves: number;
  /**
   * The first chapter it adds: the repertoire opens on it after the import.
   * Null when it adds only comments and NAGs.
   */
  readonly firstChapterId: string | null;
  /**
   * The comments and NAGs it adds to moves the repertoire already had
   * (R-176), each move once, in the order the file reaches them.
   */
  readonly annotations: readonly AddedAnnotation[];
}

/**
 * What a merge adds to a move the repertoire already had (R-176): the
 * comment it had none of (else null) and the NAGs it had none of (else
 * empty). `ply` counts half-moves from White's first move to the move,
 * along the first imported line that reaches it, as `moveNumber` takes it.
 */
export interface AddedAnnotation {
  readonly from: string;
  readonly san: string;
  readonly ply: number;
  readonly comment: string | null;
  readonly nags: readonly number[];
}

/**
 * The merge adds no chapter and no comment or NAG: nothing in the file is
 * new to the repertoire.
 */
export interface NothingToAdd {
  readonly reason: 'pgn.nothingToAdd';
}

export interface MergeRefusal {
  readonly reason: 'repertoire.sideMismatch';
}

/** A position to take the chapter's moves from, and its half-move count. */
interface Visit {
  readonly key: string;
  readonly ply: number;
}

/** Half-moves from White's first move: a root with Black to move starts at 1. */
const firstPly = (rootKey: string): number =>
  sideToMove(rootKey) === 'b' ? 1 : 0;

/** Gives a stored move the imported comment and NAGs where it has none (R-176). */
function annotate(draft: DraftMove, imported: RepertoireMove): void {
  draft.comment ??= imported.comment;
  if (draft.nags.length === 0) draft.nags = [...imported.nags];
}

/** Gives a stored move the imported comment, NAGs and marks where it has none. */
function fillIn(draft: DraftMove, imported: RepertoireMove): void {
  annotate(draft, imported);
  if (draft.arrows.length === 0 && draft.circles.length === 0) {
    draft.arrows.push(...imported.arrows);
    draft.circles.push(...imported.circles);
  }
}

/** A refused second answer, by its PGN game and full-move number (R-54). */
const refusedAnswer = (
  { san }: RepertoireMove,
  ply: number,
  pgnGame: number,
): Skipped => secondAnswer(pgnGame, san, 1 + Math.floor(ply / 2));

/**
 * Walks a chapter position by position from its root (each position once,
 * its moves in their imported order), going on past a move only when `keep`
 * keeps it, so a refused move's continuation is reached only if another kept
 * move leads there.
 */
function walk(
  root: string,
  children: Children,
  keep: (move: RepertoireMove, ply: number) => boolean,
): void {
  const queue: Visit[] = [{ key: root, ply: firstPly(root) }];
  const seen = new Set([root]);
  // The iterator re-reads the length, so this walks the queue as it grows.
  for (const visit of queue) {
    for (const move of children(visit.key)) {
      if (!keep(move, visit.ply) || seen.has(move.to)) continue;
      seen.add(move.to);
      queue.push({ key: move.to, ply: visit.ply + 1 });
    }
  }
}

/** What `after` has that `before`, the same move before the merge, had none of. */
function addedTo(
  before: RepertoireMove,
  after: RepertoireMove,
  ply: number,
): AddedAnnotation[] {
  const comment = before.comment === null ? after.comment : null;
  const nags = before.nags.length === 0 ? after.nags : [];
  if (comment === null && nags.length === 0) return [];
  return [{ from: after.from, san: after.san, ply, comment, nags }];
}

/**
 * What `after` adds to `before`, the existing repertoire, given the plies
 * at which the merge reached each existing move.
 */
function additionOf(
  before: RepertoireGraph,
  after: RepertoireGraph,
  plies: ReadonlyMap<string, number>,
): Result<MergeAddition, NothingToAdd> {
  const was = new Map(before.moves.map((m) => [moveKey(m.from, m.san), m]));
  const now = new Map(after.moves.map((m) => [moveKey(m.from, m.san), m]));
  const annotations = [...plies].flatMap(([key, ply]) => {
    const old = was.get(key);
    const merged = now.get(key);
    return old === undefined || merged === undefined
      ? []
      : addedTo(old, merged, ply);
  });
  const first = after.chapters[before.chapters.length];
  if (first === undefined && annotations.length === 0)
    return { ok: false, refusal: { reason: 'pgn.nothingToAdd' } };
  return {
    ok: true,
    value: {
      chapters: after.chapters.length - before.chapters.length,
      moves: after.moves.length - before.moves.length,
      firstChapterId: first?.id ?? null,
      annotations,
    },
  };
}

class Merge {
  readonly skipped: Skipped[] = [];
  private readonly side: Side;
  private readonly moves: RepertoireMoves;
  private readonly chapters: Chapter[];
  private readonly existing: RepertoireGraph;
  /** The move keys of the existing repertoire and of the chapters added so far. */
  private readonly known: Set<string>;
  /** The ply at which the merge first reached each move, by move key. */
  private readonly plies = new Map<string, number>();

  constructor(existing: RepertoireGraph) {
    this.side = existing.side;
    this.moves = new RepertoireMoves(existing.side, existing.moves);
    this.chapters = [...existing.chapters];
    this.existing = existing;
    this.known = new Set(existing.moves.map((m) => moveKey(m.from, m.san)));
  }

  /**
   * Adds one imported chapter if it keeps a move that neither the existing
   * repertoire nor the chapters added before it have (R-117, R-122). A
   * chapter whose moves are all refused or already there is not added; it
   * only gives its comments and NAGs to the moves it reaches that have none
   * (R-176), and its refused moves are reported.
   */
  add(source: Chapter, children: Children, pgnGame: number): void {
    const refused: Skipped[] = [];
    let fresh = 0;
    walk(source.rootKey, children, (move, ply) => {
      if (this.moves.refuses(move)) {
        refused.push(refusedAnswer(move, ply, pgnGame));
        return false;
      }
      if (!this.known.has(moveKey(move.from, move.san))) fresh += 1;
      return true;
    });
    if (fresh === 0) {
      this.skipped.push(...refused);
      this.annotateFrom(source.rootKey, children);
      return;
    }
    const chapter = this.renamed(source);
    walk(source.rootKey, children, (move, ply) =>
      this.put(move, chapter.id, pgnGame, ply),
    );
    this.chapters.push(chapter);
  }

  /**
   * The merged repertoire. An added chapter is named by its main line here
   * (R-63, R-104), which can differ from the imported one when a move was
   * refused or an existing move now comes first.
   */
  result(): MergedRepertoire {
    const graph = {
      side: this.side,
      chapters: this.chapters,
      moves: this.moves.list(),
    };
    const walks = chapterWalks(graph);
    const existing = this.existing.chapters;
    const chapters = this.chapters.map((c, i) =>
      i < existing.length
        ? c
        : namedByMoves(c, walks(c.id).mainLine(), this.chapters),
    );
    const merged = { ...graph, chapters };
    return {
      graph: merged,
      skipped: this.skipped,
      added: additionOf(this.existing, merged, this.plies),
    };
  }

  /** A new id after the existing chapters; "Chapter N" renumbered to follow them. */
  private renamed(source: Chapter): Chapter {
    const nameSource =
      source.nameSource.kind === 'index'
        ? ({ kind: 'index', number: nextChapterNumber(this.chapters) } as const)
        : source.nameSource;
    return { ...source, id: nextChapterId(this.chapters), nameSource };
  }

  /**
   * Gives the comments and NAGs of a chapter that adds no move to the moves
   * it reaches, stopping at a move the repertoire would refuse.
   */
  private annotateFrom(root: string, children: Children): void {
    walk(root, children, (move, ply) => {
      const stored = this.moves.find(move);
      if (stored === undefined) return false;
      this.reached(move, ply);
      annotate(stored, move);
      return true;
    });
  }

  private put(
    move: RepertoireMove,
    chapterId: string,
    pgnGame: number,
    ply: number,
  ): boolean {
    const put = this.moves.put(move, chapterId);
    if (!put.ok) {
      this.skipped.push(refusedAnswer(move, ply, pgnGame));
      return false;
    }
    this.known.add(moveKey(move.from, move.san));
    this.reached(move, ply);
    fillIn(put.value, move);
    return true;
  }

  /** Notes the ply of the merge's first visit to `move`. */
  private reached(move: RepertoireMove, ply: number): void {
    const key = moveKey(move.from, move.san);
    if (!this.plies.has(key)) this.plies.set(key, ply);
  }
}

/**
 * Adds `imported` to `existing` (R-101); `existing` is not changed. The
 * result says what the merge adds, or that it adds nothing (R-115).
 */
export function mergeInto(
  existing: RepertoireGraph,
  imported: ImportedRepertoire,
): Result<MergedRepertoire, MergeRefusal> {
  if (existing.side !== imported.graph.side)
    return { ok: false, refusal: { reason: 'repertoire.sideMismatch' } };
  const merge = new Merge(existing);
  const childrenOf = chapterChildren(imported.graph);
  for (const chapter of imported.graph.chapters) {
    const pgnGame = imported.pgnGames[chapter.id] ?? 0;
    merge.add(chapter, childrenOf(chapter.id), pgnGame);
  }
  return { ok: true, value: merge.result() };
}
