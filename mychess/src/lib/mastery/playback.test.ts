import { describe, it, expect } from 'vitest';
import { positionAt, playOpponentReplies } from './playback';
import type { VariationStep } from './variations';

const step = (id: string, isPlayerTurn: boolean): VariationStep =>
	({ moveId: id, san: id, fromFen: `${id}-from`, toFen: `${id}-to`, isPlayerTurn }) as VariationStep;

describe('positionAt', () => {
	const steps = [step('a', true), step('b', false)];

	it('returns the line\'s start position at ply 0', () => {
		expect(positionAt(steps, 0, 'fallback')).toBe('a-from');
	});

	it('returns the position after the requested ply', () => {
		expect(positionAt(steps, 1, 'fallback')).toBe('a-to');
		expect(positionAt(steps, 2, 'fallback')).toBe('b-to');
	});

	it('falls back when there is no line loaded, or the ply is past its end', () => {
		expect(positionAt([], 0, 'fallback')).toBe('fallback');
		expect(positionAt(steps, 99, 'fallback')).toBe('fallback');
	});

	it('treats a negative ply as the start', () => {
		expect(positionAt(steps, -3, 'fallback')).toBe('a-from');
	});
});

describe('playOpponentReplies', () => {
	it('advances through consecutive opponent plies and stops at the player\'s turn', () => {
		const steps = [step('opp1', false), step('opp2', false), step('mine', true)];
		expect(playOpponentReplies(steps, 0, 'start')).toEqual({ plyIdx: 2, fen: 'opp2-to' });
	});

	it('does nothing when the player is already on move', () => {
		const steps = [step('mine', true)];
		expect(playOpponentReplies(steps, 0, 'start')).toEqual({ plyIdx: 0, fen: 'start' });
	});

	it('does nothing at the end of a line', () => {
		const steps = [step('mine', true)];
		expect(playOpponentReplies(steps, 1, 'held')).toEqual({ plyIdx: 1, fen: 'held' });
	});

	// A line whose leaf is the opponent's reply — the last player move is not the
	// last ply, which is why callers can't just compare against steps.length.
	it('plays out a trailing opponent-only run', () => {
		const steps = [step('mine', true), step('opp', false)];
		expect(playOpponentReplies(steps, 1, 'mine-to')).toEqual({ plyIdx: 2, fen: 'opp-to' });
	});
});
