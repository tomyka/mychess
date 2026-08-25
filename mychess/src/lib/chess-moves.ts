// mychess/src/lib/chess-moves.ts
//
// The one piece of chess.js plumbing needed everywhere a SAN move has to be
// turned into board squares to draw something (a hint ring, a teaching
// arrow, the last-move highlight, the engine's suggested move) — never
// throws, and never reveals more than the two squares a move touches.

import { Chess, type Square } from 'chess.js';

/**
 * The origin/destination squares of playing `san` from `fen`, or null if the
 * move doesn't parse (an illegal SAN, or a FEN chess.js can't load). Was
 * four independently-written copies of this same try/catch shape
 * (Learn/Practice's hint square, the Games analysis page's last-move and
 * best-move arrow, `mastery/teaching.ts`'s teaching arrow) before this.
 *
 * Returns chess.js's own `Square` type rather than a plain `string` — every
 * call site eventually hands these to chessground's `Key`-typed board props,
 * and `Square` (unlike `string`) is assignable to `Key`.
 */
export function squaresForSanMove(fen: string, san: string): { from: Square; to: Square } | null {
	try {
		const move = new Chess(fen).move(san);
		return move ? { from: move.from, to: move.to } : null;
	} catch {
		return null;
	}
}
