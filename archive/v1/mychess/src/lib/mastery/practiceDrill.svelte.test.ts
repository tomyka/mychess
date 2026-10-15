// mychess/src/lib/mastery/practiceDrill.svelte.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PracticeDrill } from './practiceDrill.svelte';
import type { VariationStep } from './variations';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
const AFTER_E5 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
const AFTER_NF3 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2';

/** 1.e4 e5 2.Nf3 — two player moves with an opponent reply between them. */
const STEPS: VariationStep[] = [
	{ moveId: 'm1', san: 'e4', fromFen: START, toFen: AFTER_E4, isPlayerTurn: true },
	{ moveId: 'm2', san: 'e5', fromFen: AFTER_E4, toFen: AFTER_E5, isPlayerTurn: false },
	{ moveId: 'm3', san: 'Nf3', fromFen: AFTER_E5, toFen: AFTER_NF3, isPlayerTurn: true }
];

/** A line where the opponent moves first. */
const OPPONENT_FIRST_STEPS: VariationStep[] = [
	{ moveId: 'o1', san: 'e5', fromFen: START, toFen: AFTER_E4 /* reused fen, irrelevant */, isPlayerTurn: false },
	{ moveId: 'o2', san: 'Nf3', fromFen: AFTER_E4, toFen: AFTER_NF3, isPlayerTurn: true }
];

function makeDrill() {
	const outcomes: string[] = [];
	const advances: number[] = [];
	const drill = new PracticeDrill({
		onOutcome: (o) => outcomes.push(o),
		onAdvance: () => advances.push(1)
	});
	return { drill, outcomes, advances };
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('PracticeDrill', () => {
	it('starts on the first step, unlocked, blind', () => {
		const { drill } = makeDrill();
		drill.start(STEPS);
		expect(drill.plyIdx).toBe(0);
		expect(drill.boardFen).toBe(START);
		expect(drill.locked).toBe(false);
		expect(drill.hintRequested).toBe(false);
		expect(drill.strip).toBe('blind');
	});

	it('plays through opponent-first plies immediately on start', () => {
		const { drill } = makeDrill();
		drill.start(OPPONENT_FIRST_STEPS);
		expect(drill.plyIdx).toBe(1);
		expect(drill.boardFen).toBe(AFTER_E4);
	});

	it('resets cleanly when starting a new line over a dirty one', () => {
		const { drill } = makeDrill();
		drill.start(STEPS);
		drill.requestHint();
		expect(drill.hintRequested).toBe(true);
		expect(drill.strip).toBe('demoted');

		drill.start(STEPS);
		expect(drill.hintRequested).toBe(false);
		expect(drill.strip).toBe('blind');
		expect(drill.plyIdx).toBe(0);
	});

	it("cancels the previous line's pending advance when a new line starts", () => {
		const { drill, advances } = makeDrill();
		drill.start(STEPS);
		drill.attemptMove('b1', 'c3', 'Nc3'); // schedules a 1600ms advance
		drill.start(STEPS); // new line begins before that timer fires
		vi.advanceTimersByTime(5000);
		expect(advances).toEqual([]); // the old line's timer must not fire
	});

	describe('a correct move', () => {
		it('locks immediately and returns synchronously, before the delay resolves anything', () => {
			const { drill } = makeDrill();
			drill.start(STEPS);
			const result = drill.attemptMove('e2', 'e4', 'e4');
			expect(result).toEqual({ correct: true, moveId: 'm1' });
			expect(drill.locked).toBe(true);
			expect(drill.plyIdx).toBe(0); // not yet advanced
		});

		it('advances past the opponent reply and unlocks after 450ms, mid-line', () => {
			const { drill, outcomes, advances } = makeDrill();
			drill.start(STEPS);
			drill.attemptMove('e2', 'e4', 'e4');
			vi.advanceTimersByTime(450);

			expect(drill.plyIdx).toBe(2); // past the opponent's e5 reply too
			expect(drill.boardFen).toBe(AFTER_E5);
			expect(drill.locked).toBe(false);
			expect(drill.strip).toBe('blind');
			expect(outcomes).toEqual([]);
			expect(advances).toEqual([]);
		});

		it('reports "clean" and signals advance once the whole line is played correctly', () => {
			const { drill, outcomes, advances } = makeDrill();
			drill.start(STEPS);
			drill.attemptMove('e2', 'e4', 'e4');
			vi.advanceTimersByTime(450);
			drill.attemptMove('g1', 'f3', 'Nf3');
			vi.advanceTimersByTime(450);

			expect(outcomes).toEqual(['clean']);
			expect(advances).toEqual([]); // not yet — advance is paced separately

			vi.advanceTimersByTime(700);
			expect(advances).toEqual([1]);
		});
	});

	describe('a wrong move', () => {
		it('locks, records the mistake position, and reports "mistake" exactly once, synchronously', () => {
			const { drill, outcomes } = makeDrill();
			drill.start(STEPS);
			const result = drill.attemptMove('b1', 'c3', 'Nc3');

			expect(result).toEqual({ correct: false, moveId: 'm1' });
			expect(drill.locked).toBe(true);
			expect(drill.strip).toBe('demoted');
			expect(drill.mistakeFen).toBeTruthy();
			expect(outcomes).toEqual(['mistake']);
		});

		it('ignores a second wrong move on the same (already demoted) line — no double report', () => {
			const { drill, outcomes } = makeDrill();
			drill.start(STEPS);
			drill.attemptMove('b1', 'c3', 'Nc3');
			const second = drill.attemptMove('c2', 'c4', 'c4');

			expect(second).toBeNull(); // locked
			expect(outcomes).toEqual(['mistake']);
		});

		it('signals advance after 1600ms', () => {
			const { drill, advances } = makeDrill();
			drill.start(STEPS);
			drill.attemptMove('b1', 'c3', 'Nc3');
			vi.advanceTimersByTime(1599);
			expect(advances).toEqual([]);
			vi.advanceTimersByTime(1);
			expect(advances).toEqual([1]);
		});
	});

	describe('a hint', () => {
		it('reports "hint" exactly once and demotes, without ending the line', () => {
			const { drill, outcomes, advances } = makeDrill();
			drill.start(STEPS);
			drill.requestHint();

			expect(drill.hintRequested).toBe(true);
			expect(drill.strip).toBe('demoted');
			expect(outcomes).toEqual(['hint']);
			expect(advances).toEqual([]);
			expect(drill.locked).toBe(false); // play continues
		});

		it('is a no-op once already requested', () => {
			const { drill, outcomes } = makeDrill();
			drill.start(STEPS);
			drill.requestHint();
			drill.requestHint();
			expect(outcomes).toEqual(['hint']);
		});

		it('lets the player keep trying after a hint — a wrong move neither locks nor advances', () => {
			const { drill, outcomes, advances } = makeDrill();
			drill.start(STEPS);
			drill.requestHint();

			const result = drill.attemptMove('b1', 'c3', 'Nc3');
			expect(result).toEqual({ correct: false, moveId: 'm1' });
			expect(drill.locked).toBe(false); // still trying, not demoted-and-frozen
			expect(drill.mistakeFen).toBeTruthy();
			expect(outcomes).toEqual(['hint']); // no second report

			vi.advanceTimersByTime(5000);
			expect(advances).toEqual([]); // no forced advance either
		});

		it('keeps the demoted strip up while the hinted line is played out, and reports nothing more', () => {
			const { drill, outcomes, advances } = makeDrill();
			drill.start(STEPS);
			drill.requestHint();
			drill.attemptMove('e2', 'e4', 'e4');
			vi.advanceTimersByTime(450);
			expect(drill.strip).toBe('demoted'); // not overwritten back to 'blind'

			drill.attemptMove('g1', 'f3', 'Nf3');
			vi.advanceTimersByTime(450);
			expect(outcomes).toEqual(['hint']); // no second (clean) report

			// The line still finishes and still advances, just without a second report.
			vi.advanceTimersByTime(700);
			expect(advances).toEqual([1]);
		});
	});

	describe('cancelPendingAdvance', () => {
		it('stops a scheduled advance from firing', () => {
			const { drill, advances } = makeDrill();
			drill.start(STEPS);
			drill.attemptMove('b1', 'c3', 'Nc3');
			drill.cancelPendingAdvance();
			vi.advanceTimersByTime(5000);
			expect(advances).toEqual([]);
		});

		it('is a harmless no-op when nothing is pending', () => {
			const { drill } = makeDrill();
			drill.start(STEPS);
			expect(() => drill.cancelPendingAdvance()).not.toThrow();
		});
	});

	describe('ignored input', () => {
		it('ignores an attempt while locked', () => {
			const { drill } = makeDrill();
			drill.start(STEPS);
			drill.attemptMove('e2', 'e4', 'e4'); // locks for 450ms
			const result = drill.attemptMove('g1', 'f3', 'Nf3');
			expect(result).toBeNull();
		});

		it('ignores an attempt with no current line', () => {
			const { drill } = makeDrill();
			drill.start([]);
			expect(drill.attemptMove('e2', 'e4', 'e4')).toBeNull();
		});
	});
});
