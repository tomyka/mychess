/**
 * Adding an imported repertoire to an existing one of the same side (R-101):
 * each imported chapter becomes a new chapter, and its moves go through the
 * existing repertoire's own move store, so positions merge (a move already
 * there gains the chapter) and the player keeps one answer per position
 * (R-54). The existing repertoire wins: a shared move keeps its comment and
 * marks, and gets the imported ones only where it has none.
 */
import type { ImportedRepertoire, Skipped } from '../pgn/import-pgn';
import { sideToMove } from '../position-key';
import type { Result } from '../result';
import {
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

class Merge {
  readonly skipped: Skipped[] = [];
  private readonly side: Side;
  private readonly moves: RepertoireMoves;
  private readonly chapters: Chapter[];
  private readonly existing: number;

  constructor(existing: RepertoireGraph) {
    this.side = existing.side;
    this.moves = new RepertoireMoves(existing.side, existing.moves);
    this.chapters = [...existing.chapters];
    this.existing = existing.chapters.length;
  }

  /**
   * Adds one imported chapter, position by position from its root (each
   * position once, its moves in their imported order), so a refused move's
   * continuation is reached only if another kept move leads there. A
   * chapter none of whose moves fit is not added.
   */
  add(source: Chapter, children: Children, game: number): void {
    const chapter = this.renamed(source);
    const root = source.rootKey;
    const queue: Visit[] = [{ key: root, ply: firstPly(root) }];
    const seen = new Set([root]);
    let kept = 0;
    // The iterator re-reads the length, so this walks the queue as it grows.
    for (const visit of queue) {
      for (const move of children(visit.key)) {
        if (!this.put(move, chapter.id, game, visit.ply)) continue;
        kept += 1;
        if (seen.has(move.to)) continue;
        seen.add(move.to);
        queue.push({ key: move.to, ply: visit.ply + 1 });
      }
    }
    if (kept > 0) this.chapters.push(chapter);
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
    const chapters = this.chapters.map((c, i) =>
      i < this.existing
        ? c
        : namedByMoves(c, walks(c.id).mainLine(), this.chapters),
    );
    return { graph: { ...graph, chapters }, skipped: this.skipped };
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
    game: number,
    ply: number,
  ): boolean {
    const put = this.moves.put(move, chapterId);
    if (!put.ok) {
      const number = 1 + Math.floor(ply / 2);
      const { san } = move;
      this.skipped.push({
        game,
        reason: 'pgn.secondAnswer',
        san,
        move: number,
      });
      return false;
    }
    fillIn(put.value, move);
    return true;
  }
}

/** Adds `imported` to `existing` (R-101); `existing` is not changed. */
export function mergeInto(
  existing: RepertoireGraph,
  imported: ImportedRepertoire,
): Result<MergedRepertoire, MergeRefusal> {
  if (existing.side !== imported.graph.side)
    return { ok: false, refusal: { reason: 'repertoire.sideMismatch' } };
  const merge = new Merge(existing);
  const childrenOf = chapterChildren(imported.graph);
  for (const chapter of imported.graph.chapters)
    merge.add(chapter, childrenOf(chapter.id), imported.games[chapter.id] ?? 0);
  return { ok: true, value: merge.result() };
}
