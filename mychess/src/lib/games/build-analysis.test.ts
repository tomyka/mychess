import { describe, it, expect } from 'vitest';
import { buildAnalysis } from './build-analysis';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
const AFTER_E4_E5 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';

const moves = [
	{ ply: 1, san: 'e4', fen: AFTER_E4, parentFen: START_FEN },
	{ ply: 2, san: 'e5', fen: AFTER_E4_E5, parentFen: AFTER_E4 }
];

describe('buildAnalysis', () => {
	it('pairs each move with its before/after engine results and classifies it', () => {
		// One more result than moves: root position + one per move.
		const results = [
			{ score: { cp: 20 }, bestMoveUci: 'd2d4' }, // at START_FEN (white to move)
			{ score: { cp: -15 }, bestMoveUci: 'e7e5' }, // at AFTER_E4 (black to move)
			{ score: { cp: 10 }, bestMoveUci: 'g1f3' } // at AFTER_E4_E5 (white to move)
		];

		const analysis = buildAnalysis(moves, results);

		expect(analysis).toHaveLength(2);
		expect(analysis[0]).toEqual({
			ply: 1,
			// AFTER_E4 has black to move, so the raw -15 (black-relative) becomes
			// +15 once converted to white-relative for display.
			score: { cp: 15 },
			bestMoveSan: 'd4',
			classification: null
		});
		expect(analysis[1]).toEqual({
			ply: 2,
			// AFTER_E4_E5 has white to move, so the raw +10 is already white-relative.
			score: { cp: 10 },
			bestMoveSan: 'e5',
			// The played move (e5) IS the engine's own top choice at AFTER_E4
			// (bestMoveUci: 'e7e5') — a zero-loss move that matches the engine
			// exactly is marked 'best', not left unflagged.
			classification: 'best'
		});
	});

	it('classifies a move that loses significant ground', () => {
		const results = [
			{ score: { cp: 200 }, bestMoveUci: 'd2d4' },
			{ score: { cp: 190 }, bestMoveUci: 'e7e5' } // mover-relative: -190, a 390cp swing
		];
		const analysis = buildAnalysis([moves[0]], results);
		expect(analysis[0].classification).toBe('blunder');
	});

	it('leaves a zero-loss move unflagged when it does not match the engine\'s exact top choice', () => {
		// Both moves score the same for the mover (0 loss), but the played move
		// isn't literally the engine's own suggestion — a tie, not "the" best move.
		const results = [
			{ score: { cp: 20 }, bestMoveUci: 'd2d4' }, // engine's top pick: d4
			{ score: { cp: -20 }, bestMoveUci: 'g1f3' } // 0 loss for e4, but e4 !== d4
		];
		const analysis = buildAnalysis([moves[0]], results);
		expect(analysis[0].classification).toBeNull();
	});

	it('never marks a move both flagged and best — a real best move always has zero loss', () => {
		const results = [
			{ score: { cp: 20 }, bestMoveUci: 'e2e4' }, // engine's own top pick IS e4
			{ score: { cp: 190 }, bestMoveUci: 'e7e5' } // yet the position swung hard anyway
		];
		const analysis = buildAnalysis([moves[0]], results);
		// cpLoss still governs: a large swing is a blunder, even if bestMoveUci
		// happened to name the played move (a same-ply UCI/SAN quirk, not a
		// real scenario, but classifyMove's own verdict must win regardless).
		expect(analysis[0].classification).toBe('blunder');
	});
});
