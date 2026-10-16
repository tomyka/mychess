import { Chess, type Move } from 'chess.js';
import { positionKey } from '../position-key';
import type { Marks } from '../repertoire/graph';
import type { Result } from '../result';
import { parseMarks, type CommentMarks } from './marks';
import type { MovetextToken } from './tokenize';

/**
 * A move as replayed in its game, with the arrows and circles its PGN
 * comments draw (R-65), and where it stands in the game's move tree.
 * `parent` is the index of the move it follows (null for a move from the
 * game's root), `moveNumber` the FEN full-move number it is played at, and
 * `uci` the move in coordinates.
 */
export interface ReplayedMove extends Marks {
  readonly from: string;
  readonly to: string;
  readonly san: string;
  readonly parent: number | null;
  readonly moveNumber: number;
  readonly uci: string;
}

/**
 * A game's movetext, replayed: its moves, and its intro, the prose of the
 * comments before its first move (R-66), or null when there is none.
 */
export interface ReplayedMovetext {
  intro: string | null;
  moves: ReplayedMove[];
}

/** Why a game's movetext cannot be replayed. */
export type ReplayRefusal =
  | { reason: 'pgn.illegalMove'; san: string }
  | { reason: 'pgn.unbalancedVariation' }
  | { reason: 'pgn.variationWithoutMove' };

/**
 * A branch of the movetext being read (the main line or a variation): its
 * board, the position before its last move (where a nested variation
 * branches from), that move's index in the replayed moves and the index of
 * the move it follows (where a nested variation's moves hang from), the
 * index the branch's first move follows (`base`), and marks waiting for the
 * branch's first move.
 */
interface Branch {
  board: Chess;
  key: string;
  fenBeforeLast: string | null;
  last: number | null;
  lastParent: number | null;
  base: number | null;
  pending: Marks;
}

const noMarks: Marks = { arrows: [], circles: [] };

const newBranch = (fen: string, base: number | null): Branch => ({
  board: new Chess(fen),
  key: positionKey(fen),
  fenBeforeLast: null,
  last: null,
  lastParent: null,
  base,
  pending: noMarks,
});

/** `target` with the arrows and circles of `marks` added. */
const withMarks = <T extends Marks>(target: T, marks: Marks): T => ({
  ...target,
  arrows: [...target.arrows, ...marks.arrows],
  circles: [...target.circles, ...marks.circles],
});

function tryMove(board: Chess, san: string): Move | null {
  try {
    return board.move(san);
  } catch {
    return null;
  }
}

/**
 * Replays movetext, following every variation: `(` opens a branch from the
 * position before the current branch's last move, `)` resumes the
 * enclosing branch. The marks a comment draws attach to the move it follows,
 * or to the branch's first move when it comes before it. Comments before the
 * game's first move are its intro instead; marks there have no move to go
 * on and are dropped. The rest of a comment's prose and NAGs are not kept:
 * a repertoire move holds neither.
 */
class Replay {
  readonly moves: ReplayedMove[] = [];
  private readonly introParts: string[] = [];
  private branch: Branch;
  private readonly enclosing: Branch[] = [];

  constructor(rootFen: string) {
    this.branch = newBranch(rootFen, null);
  }

  apply(token: MovetextToken): ReplayRefusal | null {
    switch (token.kind) {
      case 'san':
        return this.play(token.san);
      case 'pgnComment':
        this.comment(parseMarks(token.text));
        return null;
      case 'nag':
        return null;
      case 'open':
        return this.open();
      case 'close':
        return this.close();
    }
  }

  finish(): ReplayRefusal | null {
    return this.enclosing.length > 0
      ? { reason: 'pgn.unbalancedVariation' }
      : null;
  }

  get intro(): string | null {
    return this.introParts.length > 0 ? this.introParts.join(' ') : null;
  }

  private comment(marks: CommentMarks): void {
    if (this.moves.length > 0) this.annotate(marks);
    else if (marks.text !== '') this.introParts.push(marks.text);
  }

  /** Adds marks to the branch's last move, or its first move to come. */
  private annotate(marks: Marks): void {
    const { last } = this.branch;
    const move = last === null ? undefined : this.moves[last];
    if (last === null || move === undefined) {
      this.branch.pending = withMarks(this.branch.pending, marks);
    } else {
      this.moves[last] = withMarks(move, marks);
    }
  }

  private play(written: string): ReplayRefusal | null {
    const { board, key, last, base } = this.branch;
    const fen = board.fen();
    const moveNumber = board.moveNumber();
    const played = tryMove(board, written);
    if (played === null) return { reason: 'pgn.illegalMove', san: written };
    const parent = last ?? base;
    const to = positionKey(played.after);
    this.moves.push({
      from: key,
      to,
      san: played.san,
      ...this.branch.pending,
      parent,
      moveNumber,
      uci: played.from + played.to + (played.promotion ?? ''),
    });
    this.branch.key = to;
    this.branch.pending = noMarks;
    this.branch.last = this.moves.length - 1;
    this.branch.fenBeforeLast = fen;
    this.branch.lastParent = parent;
    return null;
  }

  private open(): ReplayRefusal | null {
    const { fenBeforeLast: from, lastParent } = this.branch;
    if (from === null) return { reason: 'pgn.variationWithoutMove' };
    this.enclosing.push(this.branch);
    this.branch = newBranch(from, lastParent);
    return null;
  }

  private close(): ReplayRefusal | null {
    const outer = this.enclosing.pop();
    if (outer === undefined) return { reason: 'pgn.unbalancedVariation' };
    this.branch = outer;
    return null;
  }
}

/** Replays one game's movetext from `rootFen`, which must be a valid FEN. */
export function replay(
  rootFen: string,
  body: readonly MovetextToken[],
): Result<ReplayedMovetext, ReplayRefusal> {
  const game = new Replay(rootFen);
  for (const token of body) {
    const refusal = game.apply(token);
    if (refusal !== null) return { ok: false, refusal };
  }
  const refusal = game.finish();
  return refusal === null
    ? { ok: true, value: { intro: game.intro, moves: game.moves } }
    : { ok: false, refusal };
}
