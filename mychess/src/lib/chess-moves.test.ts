// mychess/src/lib/chess-moves.test.ts
import { describe, it, expect } from 'vitest';
import { squaresForSanMove } from './chess-moves';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('squaresForSanMove', () => {
	it("returns the move's origin and destination squares", () => {
		expect(squaresForSanMove(START, 'e4')).toEqual({ from: 'e2', to: 'e4' });
	});

	it('is null for a SAN that is not legal in the given position', () => {
		expect(squaresForSanMove(START, 'e5')).toBeNull();
	});

	it('is null for a SAN that does not parse at all', () => {
		expect(squaresForSanMove(START, 'not-a-move')).toBeNull();
	});

	it('is null for a FEN chess.js cannot load', () => {
		expect(squaresForSanMove('not a fen', 'e4')).toBeNull();
	});

	it('resolves a castle to the king square (not the rook)', () => {
		const kingsideReady = 'rnbqk2r/pppp1ppp/5n2/4p3/1b2P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 4 5';
		expect(squaresForSanMove(kingsideReady, 'O-O')).toEqual({ from: 'e1', to: 'g1' });
	});
});
