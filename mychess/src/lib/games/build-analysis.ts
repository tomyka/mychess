import { Chess } from 'chess.js';
import { toWhiteRelative, sideToMoveFromFen, type EngineScore } from '$lib/engine/uci';
import { cpLoss, classifyMove, type MoveClassification } from './classify';
import type { GameMove } from './parse';
import type { PositionAnalysis } from '$lib/engine/analyzeGame';

export type AnalysisEntry = {
	ply: number;
	score: EngineScore;
	bestMoveSan: string;
	classification: MoveClassification;
};

/** UCI move like "e2e4" or "e7e8q" -> its SAN at `fen`, or '' if illegal there. */
function sanFromUci(fen: string, uci: string): string {
	if (uci.length < 4) return '';
	const from = uci.slice(0, 2);
	const to = uci.slice(2, 4);
	const promotion = uci.length > 4 ? uci.slice(4) : undefined;
	try {
		const move = new Chess(fen).move({ from, to, promotion });
		return move?.san ?? '';
	} catch {
		return '';
	}
}

/**
 * Combines the engine's raw per-position results with the game's own moves
 * into what the UI/DB actually store — one entry per move. `results` must
 * be exactly one longer than `moves`: the root position's result, then one
 * per move, matching the `fens` array `analyzeGame` was called with
 * (`[rootFen, ...moves.map(m => m.fen)]`).
 */
export function buildAnalysis(moves: GameMove[], results: PositionAnalysis[]): AnalysisEntry[] {
	return moves.map((move, i) => {
		const before = results[i];
		const after = results[i + 1];
		const loss = cpLoss(before.score, after.score);
		return {
			ply: move.ply,
			score: toWhiteRelative(after.score, sideToMoveFromFen(move.fen)),
			bestMoveSan: sanFromUci(move.parentFen, before.bestMoveUci),
			classification: classifyMove(loss)
		};
	});
}
