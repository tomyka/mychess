export type EngineScore = { cp?: number; mate?: number };

/**
 * Extracts the search depth and score from a raw UCI "info ..." line. Null
 * for any line that isn't a scored info line — a "bestmove" line, an
 * "info string ..." line (no score), or anything unparseable.
 */
export function parseInfoLine(line: string): { depth: number; score: EngineScore } | null {
	if (!line.startsWith('info ')) return null;
	const depthMatch = line.match(/\bdepth (\d+)/);
	const mateMatch = line.match(/\bscore mate (-?\d+)/);
	const cpMatch = line.match(/\bscore cp (-?\d+)/);
	if (!depthMatch || (!mateMatch && !cpMatch)) return null;
	const depth = Number(depthMatch[1]);
	if (mateMatch) return { depth, score: { mate: Number(mateMatch[1]) } };
	return { depth, score: { cp: Number(cpMatch![1]) } };
}

/** The side to move from a FEN's own second field. */
export function sideToMoveFromFen(fen: string): 'w' | 'b' {
	return fen.split(' ')[1] === 'b' ? 'b' : 'w';
}

/**
 * UCI scores are relative to whoever's turn it is in the analyzed position —
 * this converts to White-relative (positive = good for White) so the number
 * means the same thing regardless of board orientation, matching the
 * chess.com/Lichess convention.
 */
export function toWhiteRelative(score: EngineScore, sideToMove: 'w' | 'b'): EngineScore {
	if (sideToMove === 'w') return score;
	if (score.mate !== undefined) return { mate: -score.mate };
	return { cp: -(score.cp ?? 0) };
}

/** "+0.35", "-1.20", "0.00", "M4", "-M6" — sign follows the White-positive convention. */
export function formatEval(score: EngineScore): string {
	if (score.mate !== undefined) {
		return score.mate > 0 ? `M${score.mate}` : `-M${Math.abs(score.mate)}`;
	}
	const pawns = (score.cp ?? 0) / 100;
	const sign = pawns > 0 ? '+' : pawns < 0 ? '-' : '';
	// One decimal, not two: this is a 400ms shallow search shown as a glance
	// signal, and a second decimal implies a precision it doesn't have — plus
	// the number now sits inside the eval bar, where fewer characters is what
	// keeps the bar narrow enough to sit beside the board.
	return `${sign}${Math.abs(pawns).toFixed(1)}`;
}

/**
 * 0..1 — how much of the eval meter should read as "White's". A simple
 * linear clamp over +/-500cp, not a win-probability curve — good enough for
 * a quick sanity check, not a serious analysis tool. Mate always fills the
 * meter fully toward whoever is mating.
 */
export function evalBarWhiteFraction(score: EngineScore): number {
	if (score.mate !== undefined) return score.mate > 0 ? 1 : 0;
	const clamped = Math.max(-500, Math.min(500, score.cp ?? 0));
	return (clamped + 500) / 1000;
}
