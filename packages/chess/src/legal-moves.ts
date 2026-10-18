/**
 * Legal moves as a board needs them: the two squares, the SAN, and the
 * promotion piece. The web board takes its destinations from here, so no
 * other package needs chess.js.
 */
import { Chess, type PieceSymbol } from 'chess.js';
import { fenOf } from './position-key';

export type Promotion = 'q' | 'r' | 'b' | 'n';

export interface BoardMove {
  readonly orig: string;
  readonly dest: string;
  readonly san: string;
  readonly promotion: Promotion | null;
}

const promotionOf = (piece: PieceSymbol | undefined): Promotion | null =>
  piece === 'q' || piece === 'r' || piece === 'b' || piece === 'n'
    ? piece
    : null;

/** Every legal move in a position key's position. */
export function legalMoves(key: string): BoardMove[] {
  return new Chess(fenOf(key)).moves({ verbose: true }).map((m) => ({
    orig: m.from,
    dest: m.to,
    san: m.san,
    promotion: promotionOf(m.promotion),
  }));
}

/** Is the side to move in check? */
export function inCheck(key: string): boolean {
  return new Chess(fenOf(key)).inCheck();
}

/** SAN without check marks or glyphs, with 0-0 read as O-O. */
const loose = (san: string): string =>
  san.replace(/[+#!?]/g, '').replace(/0/g, 'O');

const uciOf = (move: BoardMove): string =>
  move.orig + move.dest + (move.promotion ?? '');

/** The legal move typed as SAN (`Nf3`, `Nf3+`, `0-0`) or coordinates (`g1f3`), or null. */
export function findLegalMove(key: string, typed: string): BoardMove | null {
  const text = typed.trim();
  const san = loose(text);
  const uci = text.toLowerCase();
  return (
    legalMoves(key).find((m) => loose(m.san) === san || uciOf(m) === uci) ??
    null
  );
}
