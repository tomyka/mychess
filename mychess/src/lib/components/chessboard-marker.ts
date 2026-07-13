import type { Key } from 'chessground/types';

export type MarkerKind = 'star' | 'pending' | 'check' | 'cross';
export type Marker = { square: Key; kind: MarkerKind } | null;

/** ChessBoard shows a marker on the last-moved square: either the parent's
 * explicit `marker` override (Master mode's ★/pending/✓/✗ icons), or — when
 * the parent doesn't care (every other caller) — the board's own internal
 * green star on `correctSquare`, exactly as before this feature existed. */
export function resolveDisplayMarker(marker: Marker | undefined, correctSquare: Key | null): Marker {
	if (marker !== undefined) return marker;
	return correctSquare ? { square: correctSquare, kind: 'star' } : null;
}

/** Whether a `fen`/`forceRevert` change should force chessground to reapply
 * `fen`, even if `fen` textually matches the last position we applied — used
 * to snap the board back after a deferred (async, Stockfish-graded) ✗
 * verdict, when the piece was already accepted visually and `fen` itself
 * never changed. */
export function shouldResnap(
	fen: string,
	lastAppliedFen: string,
	forceRevert: number,
	lastForceRevert: number
): boolean {
	return fen !== lastAppliedFen || forceRevert !== lastForceRevert;
}
