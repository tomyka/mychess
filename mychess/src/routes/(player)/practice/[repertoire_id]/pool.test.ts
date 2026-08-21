// @vitest-environment jsdom
// mychess/src/routes/(player)/practice/[repertoire_id]/pool.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';

vi.mock('$lib/sounds', () => ({ playCorrect: vi.fn(), playWrong: vi.fn() }));

// Same harness as the Learn page's tests: chessground itself is replaced by a
// shell that remembers the config ChessBoard hands it, and `playMove` invokes
// that config's own `movable.events.after` — the exact callback chessground
// would fire after a real drag. ChessBoard's own validation and the page's
// state machine are the real thing.
const cgMock = vi.hoisted(() => ({ boards: [] as { config: any }[] }));

vi.mock('chessground', () => ({
	Chessground: (_node: HTMLElement, config: any) => {
		const entry = { config };
		cgMock.boards.push(entry);
		return {
			set: (cfg: any) => {
				entry.config = { ...entry.config, ...cfg };
			},
			destroy: () => {}
		};
	}
}));

import Practice from './+page.svelte';

function playMove(from: string, to: string) {
	cgMock.boards[cgMock.boards.length - 1].config.movable.events.after(from, to);
}

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
const AFTER_E5 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
const AFTER_NF3 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2';

/** 1.e4 e5 2.Nf3 — two player moves with an opponent reply between them. */
const STEPS = [
	{ moveId: 'm1', san: 'e4', fromFen: START, toFen: AFTER_E4, isPlayerTurn: true },
	{ moveId: 'm2', san: 'e5', fromFen: AFTER_E4, toFen: AFTER_E5, isPlayerTurn: false },
	{ moveId: 'm3', san: 'Nf3', fromFen: AFTER_E5, toFen: AFTER_NF3, isPlayerTurn: true }
];

function poolData(overrides: Record<string, unknown> = {}) {
	return {
		repertoire: { id: 'r1', name: 'French Defense', color: 'white' },
		queue: [
			{ variationKey: 'v1', path: STEPS, chapterNames: ['Chapter 1'] },
			{ variationKey: 'v2', path: STEPS, chapterNames: [] }
		],
		learnedCount: 2,
		stillLearningCount: 3,
		total: 5,
		...overrides
	};
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	cgMock.boards.length = 0;
	fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ demoted: true }) });
	vi.stubGlobal('fetch', fetchMock);
	vi.useFakeTimers();
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

const outcomes = () =>
	fetchMock.mock.calls
		.filter((c) => String(c[0]).includes('/api/practice/pool-attempt'))
		.map((c) => JSON.parse((c[1] as any).body));

describe('practice pool page', () => {
	it('locks the pool and points at Learn when nothing is learned yet', () => {
		render(Practice, { props: { data: poolData({ queue: [], learnedCount: 0 }) } });
		expect(screen.getByText(/Nothing learned yet/i)).toBeTruthy();
		expect(screen.getByText('Go to Learn')).toBeTruthy();
	});

	// The server gates the queue on WHOLE chapters (see fullyLearnedChapters),
	// so some lines can be learned with nothing yet available to practice —
	// a distinct state from "nothing learned yet" (learnedCount === 0 above).
	it('shows a different locked state when lines are learned but no whole chapter is finished', () => {
		render(Practice, { props: { data: poolData({ queue: [], learnedCount: 2 }) } });
		expect(screen.queryByText(/Nothing learned yet/i)).toBeNull();
		expect(screen.getByText(/Finish a chapter to unlock Practice/i)).toBeTruthy();
		expect(screen.getByText(/2 lines are learned/i)).toBeTruthy();
		expect(screen.getByText('Go to Learn')).toBeTruthy();
	});

	// #103: exactly one session row per visit, however many lines are played.
	it('flags only the first reported outcome as the start of a session', async () => {
		render(Practice, { props: { data: poolData() } });

		playMove('d2', 'd4');
		await vi.advanceTimersByTimeAsync(1700);
		playMove('d2', 'd4');
		await vi.advanceTimersByTimeAsync(0);

		expect(outcomes().map((o) => o.sessionStart)).toEqual([true, false]);
	});

	it("shows the queue position and the current line's chapter", () => {
		render(Practice, { props: { data: poolData() } });
		expect(screen.getByText('Line 1 of 2')).toBeTruthy();
		expect(screen.getByText('Chapter 1')).toBeTruthy();
	});

	it('never draws a teaching arrow — Practice is unaided by definition', () => {
		render(Practice, { props: { data: poolData() } });
		const shapes = cgMock.boards[cgMock.boards.length - 1].config.drawable?.autoShapes ?? [];
		expect(shapes.filter((s: any) => s.orig && s.dest)).toEqual([]);
	});

	it('reports a clean run exactly once and moves on to the next line', async () => {
		render(Practice, { props: { data: poolData() } });

		playMove('e2', 'e4');
		await vi.advanceTimersByTimeAsync(500);
		playMove('g1', 'f3');
		await vi.advanceTimersByTimeAsync(500);

		expect(outcomes()).toMatchObject([{ repertoireId: 'r1', variationKey: 'v1', outcome: 'clean' }]);

		await vi.advanceTimersByTimeAsync(800);
		expect(screen.getByText('Line 2 of 2')).toBeTruthy();
	});

	it('demotes on a wrong move and refuses a retry of the same line', async () => {
		render(Practice, { props: { data: poolData() } });

		playMove('d2', 'd4');
		await vi.advanceTimersByTimeAsync(0);

		expect(outcomes()).toMatchObject([{ repertoireId: 'r1', variationKey: 'v1', outcome: 'mistake' }]);
		expect(screen.getByRole('status').textContent).toMatch(/Back to Learn/i);

		// A second wrong move must not report a second demotion.
		playMove('c2', 'c4');
		await vi.advanceTimersByTimeAsync(0);
		expect(outcomes()).toHaveLength(1);

		await vi.advanceTimersByTimeAsync(1700);
		expect(screen.getByText('Line 2 of 2')).toBeTruthy();
	});

	it('demotes the moment a hint is taken, not when the line ends', async () => {
		render(Practice, { props: { data: poolData() } });
		await fireEvent.click(screen.getByText(/Show hint/i));

		expect(outcomes()).toMatchObject([{ repertoireId: 'r1', variationKey: 'v1', outcome: 'hint' }]);
		expect(screen.getByRole('status').textContent).toMatch(/Back to Learn/i);
	});

	it('keeps the demotion notice up while a hinted line is played out, and reports nothing more', async () => {
		render(Practice, { props: { data: poolData() } });

		await fireEvent.click(screen.getByText(/Show hint/i));
		playMove('e2', 'e4');
		await vi.advanceTimersByTimeAsync(500);

		// Not "Correct" — that would suggest the pass still counted.
		expect(screen.getByRole('status').textContent).toMatch(/Back to Learn/i);
		expect(screen.getByRole('status').textContent).not.toMatch(/Correct/i);
		playMove('g1', 'f3');
		await vi.advanceTimersByTimeAsync(500);
		expect(outcomes()).toHaveLength(1);
	});

	it('summarises the session once the queue is exhausted', async () => {
		render(Practice, {
			props: { data: poolData({ queue: [{ variationKey: 'v1', path: STEPS, chapterNames: [] }] }) }
		});

		playMove('d2', 'd4');
		await vi.advanceTimersByTimeAsync(1700);

		expect(screen.getByText(/Session complete/i)).toBeTruthy();
		expect(screen.getByText(/1 went back to Learn/i)).toBeTruthy();
		expect(screen.getByText(/Re-learn that line/i)).toBeTruthy();
	});
});
