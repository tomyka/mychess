// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';
import GamePage from './+page.svelte';
import { engineState } from '$lib/engine/engine.svelte';

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	// engineState is a module-level singleton shared across every test in the
	// process (see EvalBar.test.ts) — reset it so exploring in one test can't
	// leak an engine state into another.
	engineState.failed = false;
	engineState.ready = false;
	engineState.score = null;
	engineState.searching = false;
});

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
const AFTER_E4_E5 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
const AFTER_NF3 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2';

const doneGame = {
	id: 'g1',
	headers: { White: 'Alice', Black: 'Bob', Result: '1-0', Date: '2026.01.01' },
	played_as: 'white',
	moves: [{ ply: 1, san: 'e4', fen: AFTER_E4, parentFen: START_FEN }],
	analysis_status: 'done',
	analysis: [{ ply: 1, score: { cp: 30 }, bestMoveSan: 'e4', classification: null }]
};

const threeMoveGame = {
	...doneGame,
	moves: [
		{ ply: 1, san: 'e4', fen: AFTER_E4, parentFen: START_FEN },
		{ ply: 2, san: 'e5', fen: AFTER_E4_E5, parentFen: AFTER_E4 },
		{ ply: 3, san: 'Nf3', fen: AFTER_NF3, parentFen: AFTER_E4_E5 }
	],
	analysis: [
		{ ply: 1, score: { cp: 30 }, bestMoveSan: 'e4', classification: null },
		{ ply: 2, score: { cp: 25 }, bestMoveSan: 'e5', classification: null },
		{ ply: 3, score: { cp: 20 }, bestMoveSan: 'Nf3', classification: null }
	]
};

describe('analysis board page', () => {
	it('shows the players and result from the PGN headers', () => {
		render(GamePage, { props: { data: { game: doneGame, boardPrefs: undefined } } });
		expect(screen.getByText(/Alice/)).toBeTruthy();
		expect(screen.getByText(/Bob/)).toBeTruthy();
	});

	it('lists the recorded move', () => {
		render(GamePage, { props: { data: { game: doneGame, boardPrefs: undefined } } });
		expect(screen.getByText('e4', { exact: false })).toBeTruthy();
	});

	it('shows move classifications as chess annotation signs, not words', () => {
		const flaggedGame = {
			...threeMoveGame,
			analysis: [
				{ ply: 1, score: { cp: 30 }, bestMoveSan: 'e4', classification: null },
				{ ply: 2, score: { cp: -180 }, bestMoveSan: 'Nc6', classification: 'blunder' },
				{ ply: 3, score: { cp: 20 }, bestMoveSan: 'Nf3', classification: 'mistake' }
			]
		};
		render(GamePage, { props: { data: { game: flaggedGame, boardPrefs: undefined } } });

		// Glued directly to the move in the move list, standard chess notation —
		// no "(Blunder)"/"(Mistake)" words, no parentheses.
		expect(screen.getByRole('button', { name: 'e5??' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Nf3?' })).toBeTruthy();
		expect(screen.queryByText(/Blunder|Mistake|Inaccuracy/)).toBeNull();
	});

	it('shows the classification sign in the reviewed-move eval line too', async () => {
		const flaggedGame = {
			...threeMoveGame,
			analysis: [
				{ ply: 1, score: { cp: 30 }, bestMoveSan: 'e4', classification: null },
				{ ply: 2, score: { cp: -180 }, bestMoveSan: 'Nc6', classification: 'blunder' },
				{ ply: 3, score: { cp: 20 }, bestMoveSan: 'Nf3', classification: null }
			]
		};
		render(GamePage, { props: { data: { game: flaggedGame, boardPrefs: undefined } } });

		await fireEvent.click(screen.getByRole('button', { name: 'e5??' }));
		expect(screen.getByText(/Eval:/).closest('p')?.textContent).toContain('??');
		expect(screen.getByText(/Eval:/).closest('p')?.textContent).not.toContain('Blunder');
	});

	it("pairs White's and Black's moves for the same move number on one row, PGN-style", () => {
		render(GamePage, { props: { data: { game: threeMoveGame, boardPrefs: undefined } } });

		const whiteMove = screen.getByRole('button', { name: /^e4/ });
		const blackMove = screen.getByRole('button', { name: /^e5/ });
		const secondWhiteMove = screen.getByRole('button', { name: /^Nf3/ });

		// Move 1: White's e4 and Black's e5 share the same row.
		expect(whiteMove.closest('li')).toBe(blackMove.closest('li'));
		// Move 2: White's Nf3 (no Black reply yet) is its own row.
		expect(secondWhiteMove.closest('li')).not.toBe(whiteMove.closest('li'));

		expect(screen.getByText('1.')).toBeTruthy();
		expect(screen.getByText('2.')).toBeTruthy();
	});

	it('jumps to the right position when clicking either White or Black\'s move in a paired row', async () => {
		render(GamePage, { props: { data: { game: threeMoveGame, boardPrefs: undefined } } });

		await fireEvent.click(screen.getByRole('button', { name: /^e5/ }));
		// Black's move (ply 2) is now the reviewed position — its own eval line shows.
		expect(screen.getByText('e5', { selector: '.font-mono' })).toBeTruthy();
	});

	it('shows a pending-analysis progress state and spawns the engine for an unanalyzed game', () => {
		class FakeWorker {
			static instances: FakeWorker[] = [];
			onmessage: ((e: MessageEvent<string>) => void) | null = null;
			onerror: (() => void) | null = null;
			constructor(public url: string) {
				FakeWorker.instances.push(this);
			}
			postMessage() {}
			terminate() {}
		}
		vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker);

		const pendingGame = { ...doneGame, analysis_status: 'pending', analysis: null };
		render(GamePage, { props: { data: { game: pendingGame, boardPrefs: undefined } } });

		expect(screen.getByText('Analyzing…')).toBeTruthy();
		expect(FakeWorker.instances.length).toBe(1);
	});

	describe('explore mode', () => {
		it('shows an explore button for an already-analyzed game', () => {
			render(GamePage, { props: { data: { game: doneGame, boardPrefs: undefined } } });
			expect(screen.getByRole('button', { name: 'Explore this position' })).toBeTruthy();
		});

		it('does not show the explore button while a batch analysis is running', () => {
			class FakeWorker {
				static instances: FakeWorker[] = [];
				onmessage: ((e: MessageEvent<string>) => void) | null = null;
				onerror: (() => void) | null = null;
				constructor(public url: string) {
					FakeWorker.instances.push(this);
				}
				postMessage() {}
				terminate() {}
			}
			vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker);
			const pendingGame = { ...doneGame, analysis_status: 'pending', analysis: null };
			render(GamePage, { props: { data: { game: pendingGame, boardPrefs: undefined } } });
			expect(screen.queryByRole('button', { name: 'Explore this position' })).toBeNull();
		});

		it('replaces the move-nav row with Undo/Back-to-review controls and shows a live eval bar once exploring', async () => {
			render(GamePage, { props: { data: { game: doneGame, boardPrefs: undefined } } });
			await fireEvent.click(screen.getByRole('button', { name: 'Explore this position' }));

			expect(screen.queryByRole('button', { name: 'Explore this position' })).toBeNull();
			expect(screen.getByRole('button', { name: /Undo/ })).toBeTruthy();
			expect(screen.getByRole('button', { name: /Back to review/ })).toBeTruthy();
			expect(screen.getByRole('img', { name: /Engine evaluation/ })).toBeTruthy();
		});

		it('hides the recorded-move eval/classification line while exploring', async () => {
			render(GamePage, { props: { data: { game: doneGame, boardPrefs: undefined } } });
			await fireEvent.click(screen.getByRole('button', { name: 'Jump to current position' }));
			expect(screen.getByText(/Eval:/)).toBeTruthy();

			await fireEvent.click(screen.getByRole('button', { name: 'Explore this position' }));
			expect(screen.queryByText(/Eval:/)).toBeNull();
		});

		it('returns to the move-nav row, at the same reviewIdx, when leaving explore mode', async () => {
			render(GamePage, { props: { data: { game: doneGame, boardPrefs: undefined } } });
			await fireEvent.click(screen.getByRole('button', { name: 'Jump to current position' }));

			await fireEvent.click(screen.getByRole('button', { name: 'Explore this position' }));
			await fireEvent.click(screen.getByRole('button', { name: /Back to review/ }));

			expect(screen.getByRole('button', { name: 'Explore this position' })).toBeTruthy();
			// Still reviewing the recorded move at the position explore was entered from.
			expect(screen.getByText(/Eval:/)).toBeTruthy();
		});
	});
});
