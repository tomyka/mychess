/**
 * Adding an imported repertoire to an existing one of the same side (R-101):
 * each imported chapter becomes a new chapter, and its moves go through the
 * existing repertoire's own move store, so positions merge (a move already
 * there gains the chapter) and the player keeps one answer per position
 * (R-54). The existing repertoire wins: a shared move keeps its comment and
 * marks, and gets the imported ones only where it has none.
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
  /** The first chapter it adds: the repertoire opens on it after the import. */
  readonly firstChapterId: string;
}

/** The merge adds no chapter: nothing in the file is new to the repertoire. */
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

/** Gives a stored move the imported comment and marks where it has none. */
function fillIn(draft: DraftMove, imported: RepertoireMove): void {
  draft.comment ??= imported.comment;
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

/** What `after` adds to a repertoire of `chapters` chapters and `moves` moves. */
function additionOf(
  after: RepertoireGraph,
  chapters: number,
  moves: number,
): Result<MergeAddition, NothingToAdd> {
  const first = after.chapters[chapters];
  if (first === undefined)
    return { ok: false, refusal: { reason: 'pgn.nothingToAdd' } };
  return {
    ok: true,
    value: {
      chapters: after.chapters.length - chapters,
      moves: after.moves.length - moves,
      firstChapterId: first.id,
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
   * chapter whose moves are all refused or already there is not added and
   * changes nothing, but its refused moves are reported.
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
    const { chapters: existing, moves: existingMoves } = this.existing;
    const chapters = this.chapters.map((c, i) =>
      i < existing.length
        ? c
        : namedByMoves(c, walks(c.id).mainLine(), this.chapters),
    );
    const merged = { ...graph, chapters };
    return {
      graph: merged,
      skipped: this.skipped,
      added: additionOf(merged, existing.length, existingMoves.length),
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
    fillIn(put.value, move);
    return true;
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
