import { describe, it, expect } from 'vitest';
import { extractSingleGame } from './parse';

describe('extractSingleGame', () => {
	it('extracts headers and mainline moves from a single-game PGN', () => {
		const pgn = '[Event "Test"]\n[White "Alice"]\n[Black "Bob"]\n\n1. e4 e5 2. Nf3 *';
		const result = extractSingleGame(pgn);
		if ('error' in result) throw new Error('expected success, got error: ' + result.error);
		expect(result.game.headers.White).toBe('Alice');
		expect(result.game.headers.Black).toBe('Bob');
		expect(result.game.moves.map((m) => m.san)).toEqual(['e4', 'e5', 'Nf3']);
		expect(result.game.moves[0].ply).toBe(1);
		expect(result.game.moves[0].parentFen).toBe(
			'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
		);
	});

	it('returns an error for a PGN with no legal moves', () => {
		const result = extractSingleGame('[Event "Empty"]\n\n*');
		expect(result).toEqual({ error: 'No valid game found in that PGN.' });
	});

	it('returns an error for a multi-game PGN, asking the user to split it', () => {
		const pgn = '[Event "A"]\n\n1. e4 e5 *\n\n[Event "B"]\n\n1. d4 d5 *';
		const result = extractSingleGame(pgn);
		expect(result).toEqual({ error: 'This file contains 2 games — upload one game at a time.' });
	});
});
