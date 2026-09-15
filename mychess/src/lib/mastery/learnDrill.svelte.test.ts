// mychess/src/lib/mastery/learnDrill.svelte.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LearnDrill, CUE_HOLD_MS } from './learnDrill.svelte';
import type { VariationStep } from './variations';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
const AFTER_E5 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
const AFTER_NF3 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2';

/** 1.e4 e5 2.Nf3 — two player moves, one opponent reply. Nf3 is the last player move. */
const STEPS: VariationStep[] = [
	{ moveId: 'm1', san: 'e4', fromFen: START, toFen: AFTER_E4, isPlayerTurn: true },
	{ moveId: 'm2', san: 'e5', fromFen: AFTER_E4, toFen: AFTER_E5, isPlayerTurn: false },
	{ moveId: 'm3', san: 'Nf3', fromFen: AFTER_E5, toFen: AFTER_NF3, isPlayerTurn: true }
];

function makeDrill() {
	const finalMoves: boolean[] = [];
	const cueRetests: number[] = [];
	const finished: number[] = [];
	const drill = new LearnDrill({
		onFinalMove: (hadMistake) => finalMoves.push(hadMistake),
		onCueRetest: () => cueRetests.push(1),
		onAttemptFinished: () => finished.push(1)
	});
	return { drill, finalMoves, cueRetests, finished };
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('LearnDrill', () => {
	it('starts playing, on the first ply, nothing dirty', () => {
		const { drill } = makeDrill();
		drill.start(STEPS, { autoPlayThrough: 0, cueRetestEligible: false });
		expect(drill.phase).toBe('playing');
		expect(drill.quizIdx).toBe(0);
		expect(drill.boardFen).toBe(START);
		expect(drill.attemptHadMistake).toBe(false);
		expect(drill.attemptMistakeCount).toBe(0);
	});

	describe('autoplay intro', () => {
		it('plays through already-mastered plies before handing control back', () => {
			const { drill } = makeDrill();
			drill.start(STEPS, { autoPlayThrough: 1, cueRetestEligible: false });
			expect(drill.phase).toBe('autoplay');
			expect(drill.quizIdx).toBe(1); // the first step runs synchronously in start()

			vi.advanceTimersByTime(700);
			// Stepped past ply 0 (autoPlayThrough), then advanced through the
			// opponent's ply 1 reply automatically, landing on ply 2 (Nf3, player's).
			expect(drill.phase).toBe('playing');
			expect(drill.quizIdx).toBe(2);
			expect(drill.boardFen).toBe(AFTER_E5);
		});

		it('is skipped entirely when autoPlayThrough is 0', () => {
			const { drill } = makeDrill();
			drill.start(STEPS, { autoPlayThrough: 0, cueRetestEligible: false });
			expect(drill.phase).toBe('playing');
		});
	});

	describe('a correct move, not the final one', () => {
		it('holds for 500ms then advances past the opponent reply, without reporting anything', () => {
			const { drill, finalMoves, finished } = makeDrill();
			drill.start(STEPS, { autoPlayThrough: 0, cueRetestEligible: false });
			const result = drill.attemptMove('e2', 'e4', 'e4');

			expect(result).toEqual({ correct: true, moveId: 'm1', isFinalMove: false });
			expect(drill.locked).toBe(true);
			expect(drill.lastMoveResult).toBe('correct');
			expect(finalMoves).toEqual([]); // not the final move yet

			vi.advanceTimersByTime(500);
			expect(drill.quizIdx).toBe(2); // past e4 and the auto-played e5 reply
			expect(drill.boardFen).toBe(AFTER_E5);
			expect(drill.locked).toBe(false);
			expect(drill.lastMoveResult).toBe(null);
			expect(finished).toEqual([]); // attempt isn't done
		});
	});

	describe('the final correct move', () => {
		it('calls onFinalMove synchronously, before the 500ms hold', () => {
			const { drill, finalMoves } = makeDrill();
			drill.start(STEPS, { autoPlayThrough: 2, cueRetestEligible: false });
			vi.advanceTimersByTime(1400); // clear the autoplay intro, land on Nf3 (ply 2)

			const result = drill.attemptMove('g1', 'f3', 'Nf3');
			expect(result).toEqual({ correct: true, moveId: 'm3', isFinalMove: true });
			expect(finalMoves).toEqual([false]); // reported immediately, hadMistake=false
		});

		it('signals attempt-finished after the 500ms hold when no cue is due', () => {
			const { drill, finished } = makeDrill();
			drill.start(STEPS, { autoPlayThrough: 2, cueRetestEligible: false });
			vi.advanceTimersByTime(1400);
			drill.attemptMove('g1', 'f3', 'Nf3');

			vi.advanceTimersByTime(499);
			expect(finished).toEqual([]);
			expect(drill.phase).not.toBe('advancing');
			vi.advanceTimersByTime(1);
			expect(finished).toEqual([1]);
			expect(drill.phase).toBe('advancing');
		});

		it('reports hadMistake=true if a wrong move or a hint happened earlier this attempt', () => {
			const { drill, finalMoves } = makeDrill();
			drill.start(STEPS, { autoPlayThrough: 2, cueRetestEligible: false });
			vi.advanceTimersByTime(1400);
			drill.requestHint();

			drill.attemptMove('g1', 'f3', 'Nf3');
			expect(finalMoves).toEqual([true]);
		});

		describe('cue-eligible (clean pass, arrows shown, not the final pass)', () => {
			it('goes through a transition phase, calls onCueRetest, then finishes after CUE_HOLD_MS more', () => {
				const { drill, cueRetests, finished } = makeDrill();
				drill.start(STEPS, { autoPlayThrough: 2, cueRetestEligible: true });
				vi.advanceTimersByTime(1400);
				drill.attemptMove('g1', 'f3', 'Nf3');

				vi.advanceTimersByTime(500);
				expect(drill.phase).toBe('transition');
				expect(cueRetests).toEqual([1]);
				expect(finished).toEqual([]); // not yet — the cue hold is still running

				vi.advanceTimersByTime(CUE_HOLD_MS);
				expect(drill.phase).toBe('advancing');
				expect(finished).toEqual([1]);
			});

			it('is skipped when the pass had a mistake, even if otherwise eligible', () => {
				const { drill, cueRetests } = makeDrill();
				drill.start(STEPS, { autoPlayThrough: 2, cueRetestEligible: true });
				vi.advanceTimersByTime(1400);
				drill.requestHint(); // marks the attempt dirty

				drill.attemptMove('g1', 'f3', 'Nf3');
				vi.advanceTimersByTime(500);
				expect(drill.phase).toBe('advancing'); // straight through, no transition
				expect(cueRetests).toEqual([]);
			});
		});
	});

	describe('a wrong move', () => {
		it('never locks — the player keeps trying the same ply', () => {
			const { drill } = makeDrill();
			drill.start(STEPS, { autoPlayThrough: 0, cueRetestEligible: false });
			const result = drill.attemptMove('b1', 'c3', 'Nc3');

			expect(result).toEqual({ correct: false, moveId: 'm1', isFinalMove: false });
			expect(drill.locked).toBe(false);
			expect(drill.lastMoveResult).toBe('wrong');
			expect(drill.attemptHadMistake).toBe(true);
			expect(drill.attemptMistakeCount).toBe(1);
			expect(drill.quizIdx).toBe(0); // still on the same ply
		});

		it('counts every wrong attempt, not just the first', () => {
			const { drill } = makeDrill();
			drill.start(STEPS, { autoPlayThrough: 0, cueRetestEligible: false });
			drill.attemptMove('b1', 'c3', 'Nc3');
			drill.attemptMove('d2', 'd4', 'd4');
			expect(drill.attemptMistakeCount).toBe(2);
		});

		// GitHub issue #217. The hint was only ever a ring on the from-square
		// (`hintSquareFor` -> ChessBoard's `hintSquare`); what cost a tap was the
		// OFFER. Being wrong already spent everything a hint spends — this same
		// branch sets `attemptHadMistake` — so revealing the piece here is free,
		// and a player who has just guessed wrong is exactly who needs it.
		it('reveals the correct piece with no tap', () => {
			const { drill } = makeDrill();
			drill.start(STEPS, { autoPlayThrough: 0, cueRetestEligible: false });
			expect(drill.hintRequested).toBe(false);

			drill.attemptMove('b1', 'c3', 'Nc3');
			expect(drill.hintRequested).toBe(true);
		});

		// The point of doing it HERE and not on a timer: this must not be able to
		// make a pass any dirtier than the wrong move already made it. A timed
		// reveal fired before a mistake would void a pass the player was about to
		// get right, and `advanceTeachingProgress` advances NOTHING on a dirty
		// pass — not even `taughtPlies`.
		it('costs the attempt nothing the wrong move had not already spent', () => {
			const { drill, finalMoves } = makeDrill();
			drill.start(STEPS, { autoPlayThrough: 0, cueRetestEligible: false });
			drill.attemptMove('b1', 'c3', 'Nc3'); // wrong at ply 0: dirty, auto-reveals

			// The reveal is not a second mistake.
			expect(drill.attemptMistakeCount).toBe(1);

			// Still reports exactly what a wrong move alone reports.
			drill.attemptMove('e2', 'e4', 'e4'); // the book move for ply 0
			vi.advanceTimersByTime(500);
			drill.attemptMove('g1', 'f3', 'Nf3'); // the last player move
			expect(finalMoves).toEqual([true]);
		});

		// `attemptMove`'s correct branch clears `hintRequested` on purpose — a
		// hint is scoped to the ply it was taken on. An auto-reveal must inherit
		// that, or the ring would follow the player to the next ply and point at
		// a square with no piece on it.
		it('stops revealing once the ply is answered correctly', () => {
			const { drill } = makeDrill();
			drill.start(STEPS, { autoPlayThrough: 0, cueRetestEligible: false });
			drill.attemptMove('b1', 'c3', 'Nc3');
			expect(drill.hintRequested).toBe(true);

			drill.attemptMove('e2', 'e4', 'e4'); // the book move for ply 0
			expect(drill.hintRequested).toBe(false);
		});
	});

	describe('requestHint', () => {
		it('marks the attempt dirty unconditionally, with no guard', () => {
			const { drill } = makeDrill();
			drill.start(STEPS, { autoPlayThrough: 0, cueRetestEligible: false });
			drill.requestHint();
			expect(drill.hintRequested).toBe(true);
			expect(drill.attemptHadMistake).toBe(true);
		});

		// The exact shape of interleaving that shipped a real regression in the
		// analogous PracticeDrill extraction (a wrong move after a hint
		// incorrectly locked/advanced there). Learn's wrong-move branch has no
		// hint-dependent logic at all, but pin it down so a future edit can't
		// reintroduce that class of bug here too.
		it('taking a hint does not change how a subsequent wrong move behaves — still no lock, still playing', () => {
			const { drill } = makeDrill();
			drill.start(STEPS, { autoPlayThrough: 0, cueRetestEligible: false });
			drill.requestHint();
			const result = drill.attemptMove('b1', 'c3', 'Nc3'); // wrong

			expect(result).toEqual({ correct: false, moveId: 'm1', isFinalMove: false });
			expect(drill.locked).toBe(false);
			expect(drill.phase).toBe('playing');
			expect(drill.quizIdx).toBe(0);
		});
	});

	describe('start()', () => {
		it("resets all per-attempt state, and cancels a previous line's pending timers", () => {
			const { drill, finished } = makeDrill();
			drill.start(STEPS, { autoPlayThrough: 2, cueRetestEligible: false });
			vi.advanceTimersByTime(1400);
			drill.attemptMove('g1', 'f3', 'Nf3'); // schedules the 500ms advance-to-finished timer

			drill.start(STEPS, { autoPlayThrough: 0, cueRetestEligible: false }); // new attempt starts first
			expect(drill.quizIdx).toBe(0);
			expect(drill.phase).toBe('playing');
			expect(drill.locked).toBe(false);
			expect(drill.attemptHadMistake).toBe(false);
			expect(drill.lastMoveResult).toBe(null);

			vi.advanceTimersByTime(5000);
			expect(finished).toEqual([]); // the old line's timer must never fire
		});

		it('handles an empty path without throwing', () => {
			const { drill } = makeDrill();
			expect(() => drill.start([], { autoPlayThrough: 0, cueRetestEligible: false })).not.toThrow();
			expect(drill.boardFen).toBe('');
		});
	});

	describe('ignored input', () => {
		it('ignores an attempt while locked', () => {
			const { drill } = makeDrill();
			drill.start(STEPS, { autoPlayThrough: 0, cueRetestEligible: false });
			drill.attemptMove('e2', 'e4', 'e4'); // locks for 500ms
			expect(drill.attemptMove('g1', 'f3', 'Nf3')).toBeNull();
		});

		it('ignores an attempt while autoplay is running', () => {
			const { drill } = makeDrill();
			drill.start(STEPS, { autoPlayThrough: 1, cueRetestEligible: false });
			expect(drill.attemptMove('e2', 'e4', 'e4')).toBeNull();
		});

		it('ignores an attempt with no current step', () => {
			const { drill } = makeDrill();
			drill.start([], { autoPlayThrough: 0, cueRetestEligible: false });
			expect(drill.attemptMove('e2', 'e4', 'e4')).toBeNull();
		});
	});
});
