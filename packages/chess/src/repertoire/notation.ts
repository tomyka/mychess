// How a line's moves are numbered when written out: `6.` before White's
// move, `6...` before Black's.
import type { Side } from './graph';

/**
 * The number shown before the move `ply` half-moves after a chapter's root:
 * `6.` for White, `6...` for Black. A position key has no move counter, so
 * the count starts from the root (move 1).
 */
export function moveNumber(ply: number, whiteFirst: boolean): string {
  const half = ply + (whiteFirst ? 0 : 1);
  const number = String(Math.floor(half / 2) + 1);
  return half % 2 === 0 ? `${number}.` : `${number}...`;
}

/**
 * `san`, `side`'s move at full move `fullMove`, as players read it alone:
 * "2. Bf4" for White, "5...a6" for Black.
 */
export function numberedMove(
  fullMove: number,
  side: Side,
  san: string,
): string {
  const dots = side === 'black' ? '...' : '. ';
  return `${String(fullMove)}${dots}${san}`;
}

/**
 * "1. e4 c6 2. d4": a line's moves from a chapter's root as one string, with
 * a number before the first move and before every White move.
 */
export function lineText(sans: readonly string[], whiteFirst: boolean): string {
  return sans
    .map((san, ply) => {
      const number = moveNumber(ply, whiteFirst);
      return ply === 0 || !number.endsWith('...') ? `${number} ${san}` : san;
    })
    .join(' ');
}
