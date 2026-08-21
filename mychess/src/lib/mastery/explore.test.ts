// mychess/src/lib/mastery/explore.test.ts
import { describe, it, expect } from 'vitest';
import { ExploreSession } from './explore.svelte';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

describe('ExploreSession', () => {
	it('starts inactive, with nothing to show', () => {
		const explore = new ExploreSession();
		expect(explore.active).toBe(false);
		expect(explore.fen).toBe('');
		expect(explore.depth).toBe(0);
	});

	it('opens on the position it was handed', () => {
		const explore = new ExploreSession();
		expect(explore.start(START)).toBe(true);
		expect(explore.active).toBe(true);
		expect(explore.fen).toBe(START);
	});

	it('refuses to open on an empty or unloadable position', () => {
		const explore = new ExploreSession();
		expect(explore.start('')).toBe(false);
		expect(explore.start('not a fen')).toBe(false);
		expect(explore.active).toBe(false);
	});

	it('accepts a legal move and advances the position', () => {
		const explore = new ExploreSession();
		explore.start(START);
		expect(explore.play('e2', 'e4')).toBe(true);
		expect(explore.fen).toBe(AFTER_E4);
		expect(explore.sans).toEqual(['e4']);
		expect(explore.depth).toBe(1);
	});

	// The point of going off-book is usually to see the opponent's best answer,
	// so both colours are playable — this is a scratch board, not a drill.
	it('lets the opponent move too', () => {
		const explore = new ExploreSession();
		explore.start(START);
		explore.play('e2', 'e4');
		expect(explore.play('e7', 'e5')).toBe(true);
		expect(explore.sans).toEqual(['e4', 'e5']);
	});

	it('refuses an illegal move and leaves the position alone', () => {
		const explore = new ExploreSession();
		explore.start(START);
		expect(explore.play('e2', 'e5')).toBe(false);
		expect(explore.fen).toBe(START);
		expect(explore.depth).toBe(0);
	});

	it('ignores moves while inactive', () => {
		const explore = new ExploreSession();
		expect(explore.play('e2', 'e4')).toBe(false);
	});

	it('undoes one move at a time, and stops at the position it started from', () => {
		const explore = new ExploreSession();
		explore.start(START);
		explore.play('e2', 'e4');
		explore.play('e7', 'e5');

		explore.undo();
		expect(explore.fen).toBe(AFTER_E4);
		expect(explore.sans).toEqual(['e4']);

		explore.undo();
		expect(explore.fen).toBe(START);
		expect(explore.depth).toBe(0);

		explore.undo(); // already home
		expect(explore.fen).toBe(START);
		expect(explore.active).toBe(true);
	});

	it('promotes to a queen rather than refusing the move', () => {
		const explore = new ExploreSession();
		explore.start('8/P7/8/8/8/8/8/K6k w - - 0 1');
		expect(explore.play('a7', 'a8')).toBe(true);
		expect(explore.sans[0]).toContain('=Q');
	});

	it('clears itself on stop, so the next excursion starts fresh', () => {
		const explore = new ExploreSession();
		explore.start(START);
		explore.play('e2', 'e4');
		explore.stop();
		expect(explore.active).toBe(false);
		expect(explore.fen).toBe('');
		expect(explore.depth).toBe(0);

		explore.start(AFTER_E4);
		expect(explore.fen).toBe(AFTER_E4);
		expect(explore.sans).toEqual([]);
	});
});
