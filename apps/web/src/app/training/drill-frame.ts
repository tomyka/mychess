// What a drill shows now, decided once from its state (#384): the item
// drilled, the position on the board and the move that led to it, the
// arrow, the hint's piece, the answer's flash, whether the board or the
// move field takes a move, and the side asked to move. Each drill's state
// says what it asks; this applies the wrong move's hold (#381, R-59): the
// wrong move stays on the board for its flash in place of the asked
// position, with no arrow or hint, and no move is taken meanwhile. The
// board adapter (drill-board) only draws the frame.
import {
  positionAfterMove,
  sideToMove,
  START_KEY,
  type BoardMove,
  type RepertoireMove,
} from '@mychess/chess';
import type { ItemIds } from './session-header';

/** A square's answer flash (docs/design/training-screen.md, Move feedback). */
export interface Flash {
  readonly square: string;
  readonly kind: 'correct' | 'wrong';
  /** A wrong move, held on the board while its flash shows (#381). */
  readonly after?: { readonly key: string; readonly uci: string };
}

/** The flash of the player's `move` from `key`: a wrong one holds its position. */
export function answerFlash(
  key: string,
  move: BoardMove,
  right: boolean,
): Flash {
  if (right) return { square: move.dest, kind: 'correct' };
  const uci = `${move.orig}${move.dest}${move.promotion ?? ''}`;
  const after = { key: positionAfterMove(key, move), uci };
  return { square: move.dest, kind: 'wrong', after };
}

/** What a drill asks now, before any hold: the item drilled, by its ids, and its position. */
export interface Asked extends ItemIds {
  /** The position asked, as a position key. */
  readonly key: string;
  /** The move that led to it (UCI), if any. */
  readonly last: string | undefined;
  /** The move shown as an arrow (UCI), if any. */
  readonly arrow?: string | undefined;
  /** The move whose piece is marked as the hint (UCI), if any. */
  readonly hint?: string | undefined;
  /** Does the board take a move? */
  readonly playable: boolean;
  /**
   * Does the move field take a move? Also while the opponent's move still
   * slides in: the position is the player's already, and a move typed the
   * moment the reply shows must not be lost (#324).
   */
  readonly typeable: boolean;
}

/**
 * The position at the end of `moves` played from `rootKey` (the start
 * without one), and the move that led to it.
 */
export function lineEnd(
  moves: readonly RepertoireMove[],
  rootKey: string | undefined,
): Pick<Asked, 'key' | 'last'> {
  const last = moves.at(-1);
  return { key: last?.to ?? rootKey ?? START_KEY, last: last?.uci };
}

/** The answer's marks a drill keeps. */
export interface Marks {
  readonly flash: Flash | null;
  /** Bumped to put a refused piece back (BoardView.revision). */
  readonly revision: number;
}

export type Color = 'white' | 'black';

/** What the drill shows now. */
export interface DrillFrame extends Asked, Marks {
  /** The position asked: the moves taken are its. */
  readonly asked: string;
  /** The position on the board: the asked one, or a wrong move held. */
  readonly key: string;
  /** The side asked to move: the asked position's, also during a hold. */
  readonly toMove: Color;
}

/** The side to move in the position `key`, in the board's words. */
export const colorToMove = (key: string): Color =>
  sideToMove(key) === 'w' ? 'white' : 'black';

/** What `asked` shows with `marks`: a wrong move held in its place (#381). */
export function drillFrame(asked: Asked, marks: Marks): DrillFrame {
  const frame: DrillFrame = {
    ...asked,
    asked: asked.key,
    flash: marks.flash,
    revision: marks.revision,
    toMove: colorToMove(asked.key),
  };
  const held = marks.flash?.kind === 'wrong' ? marks.flash.after : undefined;
  if (held === undefined) return frame;
  return {
    ...frame,
    key: held.key,
    last: held.uci,
    arrow: undefined,
    hint: undefined,
    playable: false,
    typeable: false,
  };
}
