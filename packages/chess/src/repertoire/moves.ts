/**
 * The moves of a repertoire while it is built or edited, under the
 * repertoire's two storage rules: a move is stored once per position (its
 * move key), and the player keeps at most one answer per position across all
 * of the repertoire's chapters (R-54). The builder (`edit.ts`) and the PGN
 * import both put their moves through it, so the rules live here only.
 *
 * Mutable and indexed, so each move costs about the same however large the
 * repertoire; `list()` hands out copies of the moves in insertion order.
 */
import type { Result } from '../result';
import {
  isPlayerMove,
  moveKey,
  type Arrow,
  type Circle,
  type RepertoireMove,
  type Side,
} from './graph';

/** A move as played on a board: what a repertoire move is made from. */
export interface PlayedMove {
  readonly from: string;
  readonly to: string;
  readonly san: string;
  readonly uci: string;
}

/** A stored move whose marks and chapters can still grow, and whose comment can be set. */
export interface DraftMove extends PlayedMove {
  readonly arrows: Arrow[];
  readonly circles: Circle[];
  comment: string | null;
  readonly chapters: string[];
}

export interface SecondAnswer {
  readonly reason: 'repertoire.secondAnswer';
}

const draftOf = (
  { from, to, san, uci }: PlayedMove,
  rest: Pick<RepertoireMove, 'arrows' | 'circles' | 'comment' | 'chapters'>,
): DraftMove => ({
  from,
  to,
  san,
  uci,
  arrows: [...rest.arrows],
  circles: [...rest.circles],
  comment: rest.comment,
  chapters: [...rest.chapters],
});

export class RepertoireMoves {
  private readonly side: Side;
  private readonly byKey = new Map<string, DraftMove>();
  /**
   * The positions with a stored move. Every move from a position is played
   * by the side to move there, so a player move from one of them would be a
   * second answer.
   */
  private readonly occupied = new Set<string>();

  /** Starts from `moves`, which it copies rather than changes. */
  constructor(side: Side, moves: readonly RepertoireMove[] = []) {
    this.side = side;
    for (const move of moves) this.store(draftOf(move, move));
  }

  /**
   * Puts `move` into a chapter. A move the repertoire already has gains the
   * chapter; a new move is added, unless it would give the player a second
   * answer in its position. Returns the stored move.
   */
  put(move: PlayedMove, chapterId: string): Result<DraftMove, SecondAnswer> {
    const existing = this.byKey.get(moveKey(move.from, move.san));
    if (existing !== undefined) {
      if (!existing.chapters.includes(chapterId))
        existing.chapters.push(chapterId);
      return { ok: true, value: existing };
    }
    if (this.refuses(move)) {
      return { ok: false, refusal: { reason: 'repertoire.secondAnswer' } };
    }
    const draft = draftOf(move, {
      arrows: [],
      circles: [],
      comment: null,
      chapters: [],
    });
    draft.chapters.push(chapterId);
    this.store(draft);
    return { ok: true, value: draft };
  }

  /**
   * Whether `put` would refuse `move` as a second answer, without putting
   * it: a move already stored is never refused.
   */
  refuses(move: PlayedMove): boolean {
    if (this.byKey.has(moveKey(move.from, move.san))) return false;
    return this.isPlayerMove(move) && this.occupied.has(move.from);
  }

  /**
   * Every stored move, in the order it was first stored, as copies: a later
   * `put` does not change a list already handed out.
   */
  list(): RepertoireMove[] {
    return [...this.byKey.values()].map((move) => draftOf(move, move));
  }

  private isPlayerMove(move: PlayedMove): boolean {
    return isPlayerMove({ side: this.side }, move);
  }

  private store(draft: DraftMove): void {
    this.byKey.set(moveKey(draft.from, draft.san), draft);
    this.occupied.add(draft.from);
  }
}
