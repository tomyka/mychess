import { Chess } from 'chess.js';
import { positionKey } from '../position-key';
import type { Arrow, Circle } from '../repertoire/graph';
import type { Result } from '../result';
import { parseMarks } from './marks';
import type { MovetextToken } from './tokenize';

/**
 * What a PGN file says about a move: the prose of its `{...}` comments
 * (PGN's own word; not a Thread comment or a note), its NAGs, and the
 * arrows and circles its comments draw (R-65).
 */
interface PgnCommentary {
  pgnComments: string[];
  nags: number[];
  arrows: Arrow[];
  circles: Circle[];
}

/** One move as it occurs in a game's movetext, with its PGN commentary. */
export interface MoveOccurrence extends PgnCommentary {
  from: string;
  to: string;
  san: string;
}

/**
 * A game's movetext, replayed: its moves, and its intro, the prose of the
 * comments before its first move (R-66), or null when there is none.
 */
export interface ReplayedMovetext {
  intro: string | null;
  moves: MoveOccurrence[];
}

/** Why a game's movetext cannot be replayed. */
export type ReplayRefusal =
  | { reason: 'pgn.illegalMove'; san: string }
  | { reason: 'pgn.unbalancedVariation' }
  | { reason: 'pgn.variationWithoutMove' };

/**
 * A branch of the movetext being read (the main line or a variation): its
 * board, the position before its last move (where a nested variation
 * branches from), that move's commentary, and commentary waiting for the
 * branch's first move.
 */
interface Branch {
  board: Chess;
  fenBeforeLast: string | null;
  last: PgnCommentary | null;
  pending: PgnCommentary;
}

const noCommentary = (): PgnCommentary => ({
  pgnComments: [],
  nags: [],
  arrows: [],
  circles: [],
});

const newBranch = (fen: string): Branch => ({
  board: new Chess(fen),
  fenBeforeLast: null,
  last: null,
  pending: noCommentary(),
});

function tryMove(board: Chess, san: string): string | null {
  try {
    return board.move(san).san;
  } catch {
    return null;
  }
}

/**
 * Replays movetext, following every variation: `(` opens a branch from the
 * position before the current branch's last move, `)` resumes the
 * enclosing branch. Comments and NAGs attach to the move they follow, or to
 * the branch's first move when they come before it. Comments before the
 * game's first move are its intro instead; marks there have no move to go
 * on and are dropped.
 */
class Replay {
  readonly moves: MoveOccurrence[] = [];
  private readonly introParts: string[] = [];
  private branch: Branch;
  private readonly enclosing: Branch[] = [];

  constructor(rootFen: string) {
    this.branch = newBranch(rootFen);
  }

  apply(token: MovetextToken): ReplayRefusal | null {
    switch (token.kind) {
      case 'san':
        return this.play(token.san);
      case 'pgnComment':
        this.comment(token.text);
        return null;
      case 'nag':
        this.commentary().nags.push(token.nag);
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

  private comment(raw: string): void {
    const { text, arrows, circles } = parseMarks(raw);
    if (this.moves.length === 0) {
      if (text !== '') this.introParts.push(text);
      return;
    }
    const commentary = this.commentary();
    if (text !== '') commentary.pgnComments.push(text);
    commentary.arrows.push(...arrows);
    commentary.circles.push(...circles);
  }

  private commentary(): PgnCommentary {
    return this.branch.last ?? this.branch.pending;
  }

  private play(written: string): ReplayRefusal | null {
    const { board } = this.branch;
    const fen = board.fen();
    const san = tryMove(board, written);
    if (san === null) return { reason: 'pgn.illegalMove', san: written };
    const commentary = this.branch.pending;
    this.moves.push({
      from: positionKey(fen),
      to: positionKey(board.fen()),
      san,
      ...commentary,
    });
    this.branch.pending = noCommentary();
    this.branch.last = commentary;
    this.branch.fenBeforeLast = fen;
    return null;
  }

  private open(): ReplayRefusal | null {
    const from = this.branch.fenBeforeLast;
    if (from === null) return { reason: 'pgn.variationWithoutMove' };
    this.enclosing.push(this.branch);
    this.branch = newBranch(from);
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
