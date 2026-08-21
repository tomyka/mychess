// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import GamePage from './+page.svelte';

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

const doneGame = {
	id: 'g1',
	headers: { White: 'Alice', Black: 'Bob', Result: '1-0', Date: '2026.01.01' },
	played_as: 'white',
	moves: [{ ply: 1, san: 'e4', fen: AFTER_E4, parentFen: START_FEN }],
	analysis_status: 'done',
	analysis: [{ ply: 1, score: { cp: 30 }, bestMoveSan: 'e4', classification: null }]
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
});
