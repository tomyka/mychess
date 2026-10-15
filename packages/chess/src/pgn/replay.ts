import { Chess } from 'chess.js';
import { positionKey } from '../position-key';
import type { Result } from '../result';
import type { MovetextToken } from './tokenize';

/** One move as it occurs in a game's movetext, with its annotations. */
export interface MoveOccurrence {
  from: string;
  to: string;
  san: string;
  comments: string[];
  nags: number[];
}

/** Why a game's movetext cannot be replayed. */
export type ReplayRefusal =
  | { reason: 'pgn.illegalMove'; san: string }
  | { reason: 'pgn.unbalancedVariation' }
  | { reason: 'pgn.variationWithoutMove' };

interface Annotations {
  comments: string[];
  nags: number[];
}

/**
 * A line being read: its board, the position before its last move (where a
 * variation branches from), that move's annotations, and annotations
 * waiting for the line's first move.
 */
interface Line {
  board: Chess;
  fenBeforeLast: string | null;
  last: Annotations | null;
  pending: Annotations;
}

const noAnnotations = (): Annotations => ({ comments: [], nags: [] });

const newLine = (fen: string): Line => ({
  board: new Chess(fen),
  fenBeforeLast: null,
  last: null,
  pending: noAnnotations(),
});

function tryMove(board: Chess, san: string): string | null {
  try {
    return board.move(san).san;
  } catch {
    return null;
  }
}

/**
 * Replays movetext, following every variation: `(` branches from the
 * position before the line's last move, `)` resumes the enclosing line.
 * Comments and NAGs attach to the move they follow, or to the line's first
 * move when they come before it.
 */
class Replay {
  readonly moves: MoveOccurrence[] = [];
  private line: Line;
  private readonly enclosing: Line[] = [];

  constructor(rootFen: string) {
    this.line = newLine(rootFen);
  }

  apply(token: MovetextToken): ReplayRefusal | null {
    switch (token.kind) {
      case 'san':
        return this.play(token.san);
      case 'comment':
        this.annotations().comments.push(token.text);
        return null;
      case 'nag':
        this.annotations().nags.push(token.nag);
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

  private annotations(): Annotations {
    return this.line.last ?? this.line.pending;
  }

  private play(written: string): ReplayRefusal | null {
    const { board } = this.line;
    const fen = board.fen();
    const san = tryMove(board, written);
    if (san === null) return { reason: 'pgn.illegalMove', san: written };
    const annotations = this.line.pending;
    this.moves.push({
      from: positionKey(fen),
      to: positionKey(board.fen()),
      san,
      ...annotations,
    });
    this.line.pending = noAnnotations();
    this.line.last = annotations;
    this.line.fenBeforeLast = fen;
    return null;
  }

  private open(): ReplayRefusal | null {
    const from = this.line.fenBeforeLast;
    if (from === null) return { reason: 'pgn.variationWithoutMove' };
    this.enclosing.push(this.line);
    this.line = newLine(from);
    return null;
  }

  private close(): ReplayRefusal | null {
    const outer = this.enclosing.pop();
    if (outer === undefined) return { reason: 'pgn.unbalancedVariation' };
    this.line = outer;
    return null;
  }
}

/** Replays one game's movetext from `rootFen`, which must be a valid FEN. */
export function replay(
  rootFen: string,
  body: readonly MovetextToken[],
): Result<MoveOccurrence[], ReplayRefusal> {
  const game = new Replay(rootFen);
  for (const token of body) {
    const refusal = game.apply(token);
    if (refusal !== null) return { ok: false, refusal };
  }
  const refusal = game.finish();
  return refusal === null
    ? { ok: true, value: game.moves }
    : { ok: false, refusal };
}
