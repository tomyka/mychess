import { describe, it, expect, vi } from 'vitest';
import { positionAt, playOpponentReplies, playerMovesIn, hintSquareFor, makeReviewNav, makeReviewKeyHandler } from './playback';
import type { VariationStep } from './variations';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

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

describe('playerMovesIn', () => {
	// The move-nav counter reads in the player's own moves, so an auto-played
	// opponent reply must not advance it — the number would jump by two per tap
	// and read as twice the line's real length.
	const steps = [step('mine1', true), step('opp1', false), step('mine2', true), step('opp2', false)];

	it('counts only the player\'s own moves', () => {
		expect(playerMovesIn(steps, 0)).toBe(0);
		expect(playerMovesIn(steps, 1)).toBe(1);
		expect(playerMovesIn(steps, 2)).toBe(1); // opponent reply played, still one move in
		expect(playerMovesIn(steps, 3)).toBe(2);
		expect(playerMovesIn(steps, 4)).toBe(2); // trailing opponent reply doesn't count
	});

	it('handles an empty path and a ply count past the end', () => {
		expect(playerMovesIn([], 3)).toBe(0);
		expect(playerMovesIn(steps, 99)).toBe(2);
	});

	it('counts a line the opponent opens', () => {
		const opensWithOpponent = [step('opp1', false), step('mine1', true)];
		expect(playerMovesIn(opensWithOpponent, 1)).toBe(0);
		expect(playerMovesIn(opensWithOpponent, 2)).toBe(1);
	});
});

describe('hintSquareFor', () => {
	const steps: VariationStep[] = [{ moveId: 'm1', san: 'e4', fromFen: START, toFen: AFTER_E4, isPlayerTurn: true }];

	it("returns the correct move's origin square, never the destination", () => {
		expect(hintSquareFor(steps, 0, true, false)).toBe('e2');
	});

	it('is null when no hint was requested', () => {
		expect(hintSquareFor(steps, 0, false, false)).toBeNull();
	});

	it('is null while reviewing an earlier position', () => {
		expect(hintSquareFor(steps, 0, true, true)).toBeNull();
	});

	it('is null with no current step', () => {
		expect(hintSquareFor([], 0, true, false)).toBeNull();
		expect(hintSquareFor(steps, 5, true, false)).toBeNull();
	});

	it('is null for a step whose SAN does not parse from its own FEN', () => {
		const bad: VariationStep[] = [{ moveId: 'm1', san: 'Zz9', fromFen: START, toFen: AFTER_E4, isPlayerTurn: true }];
		expect(hintSquareFor(bad, 0, true, false)).toBeNull();
	});
});

describe('makeReviewNav', () => {
	function makeNav(initial: number | null, live: number) {
		let value = initial;
		const nav = makeReviewNav({
			get: () => value,
			set: (v) => (value = v),
			reviewIdx: () => value ?? live,
			liveIdx: () => live
		});
		return { nav, getValue: () => value };
	}

	it('reviewToStart jumps to ply 0', () => {
		const { nav, getValue } = makeNav(null, 4);
		nav.reviewToStart();
		expect(getValue()).toBe(0);
	});

	it('reviewBack steps back one ply from the live position, never past 0', () => {
		const { nav, getValue } = makeNav(null, 0);
		nav.reviewBack();
		expect(getValue()).toBe(0); // clamped, not -1
	});

	it('reviewForward steps forward, snapping back to live (null) at the end', () => {
		const { nav, getValue } = makeNav(2, 4);
		nav.reviewForward();
		expect(getValue()).toBe(3);
		nav.reviewForward();
		expect(getValue()).toBe(null); // reached live — back to "following the live position"
	});

	it('reviewToLive clears back to null', () => {
		const { nav, getValue } = makeNav(1, 4);
		nav.reviewToLive();
		expect(getValue()).toBeNull();
	});
});

describe('makeReviewKeyHandler', () => {
	function makeHandlerWithSpies(enabled = true) {
		const spies = {
			reviewToStart: vi.fn(),
			reviewBack: vi.fn(),
			reviewForward: vi.fn(),
			reviewToLive: vi.fn()
		};
		const handler = makeReviewKeyHandler({ ...spies, isEnabled: () => enabled });
		return { handler, spies };
	}

	function keydown(key: string): KeyboardEvent {
		return { key, preventDefault: vi.fn() } as unknown as KeyboardEvent;
	}

	it('maps each arrow key to its own action, preventing default', () => {
		const { handler, spies } = makeHandlerWithSpies();

		const left = keydown('ArrowLeft');
		handler(left);
		expect(spies.reviewBack).toHaveBeenCalledOnce();
		expect(left.preventDefault).toHaveBeenCalledOnce();

		handler(keydown('ArrowRight'));
		expect(spies.reviewForward).toHaveBeenCalledOnce();

		handler(keydown('ArrowUp'));
		expect(spies.reviewToStart).toHaveBeenCalledOnce();

		handler(keydown('ArrowDown'));
		expect(spies.reviewToLive).toHaveBeenCalledOnce();
	});

	it('ignores every key when disabled', () => {
		const { handler, spies } = makeHandlerWithSpies(false);
		handler(keydown('ArrowLeft'));
		expect(spies.reviewBack).not.toHaveBeenCalled();
	});

	it('ignores keys it does not handle', () => {
		const { handler, spies } = makeHandlerWithSpies();
		const other = keydown('Enter');
		handler(other);
		expect(other.preventDefault).not.toHaveBeenCalled();
		expect(Object.values(spies).some((s) => s.mock.calls.length > 0)).toBe(false);
	});
});
