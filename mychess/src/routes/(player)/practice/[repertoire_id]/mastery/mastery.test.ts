// @vitest-environment jsdom
// mychess/src/routes/(player)/practice/[repertoire_id]/mastery/mastery.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';

vi.mock('$lib/sounds', () => ({ playCorrect: vi.fn(), playWrong: vi.fn() }));

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

import Mastery from './+page.svelte';

function playMove(from: string, to: string) {
	cgMock.boards[cgMock.boards.length - 1].config.movable.events.after(from, to);
}

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
const AFTER_E5 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
const AFTER_NF3 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2';

const LINE_A = [
	{ moveId: 'a1', san: 'e4', fromFen: START, toFen: AFTER_E4, isPlayerTurn: true },
	{ moveId: 'a2', san: 'e5', fromFen: AFTER_E4, toFen: AFTER_E5, isPlayerTurn: false },
	{ moveId: 'a3', san: 'Nf3', fromFen: AFTER_E5, toFen: AFTER_NF3, isPlayerTurn: true }
];
const LINE_B = [{ moveId: 'b1', san: 'e4', fromFen: START, toFen: AFTER_E4, isPlayerTurn: true }];

function masteryData(overrides: Record<string, unknown> = {}) {
	return {
		repertoire: { id: 'r1', name: 'French Defense', color: 'white' },
		chapters: [
			{ chapter: 'Open', total: 2, learned: 2, canRun: true, mastered: false },
			{ chapter: 'Closed', total: 3, learned: 1, canRun: false, mastered: false }
		],
		queues: {
			Open: [
				{ variationKey: 'a', path: LINE_A },
				{ variationKey: 'b', path: LINE_B }
			]
		},
		allMastered: false,
		...overrides
	};
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	cgMock.boards.length = 0;
	fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ mastered: true }) });
	vi.stubGlobal('fetch', fetchMock);
	vi.useFakeTimers();
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('chapter mastery runs', () => {
	it('lists chapters and only unlocks a run once the chapter is fully learned', () => {
		render(Mastery, { props: { data: masteryData() } });
		expect(screen.getByText('2/2 learned')).toBeTruthy();
		expect((screen.getAllByText('Start run')[0] as HTMLButtonElement).disabled).toBe(false);
		expect((screen.getAllByText('Start run')[1] as HTMLButtonElement).disabled).toBe(true);
		expect(screen.getByText(/finish learning to unlock/i)).toBeTruthy();
	});

	it('offers no hint control at all during a run', async () => {
		render(Mastery, { props: { data: masteryData() } });
		await fireEvent.click(screen.getAllByText('Start run')[0]);
		expect(screen.queryByText(/hint/i)).toBeNull();
	});

	it('draws no arrows during a run', async () => {
		render(Mastery, { props: { data: masteryData() } });
		await fireEvent.click(screen.getAllByText('Start run')[0]);
		const shapes = cgMock.boards[cgMock.boards.length - 1].config.drawable?.autoShapes ?? [];
		expect(shapes.filter((s: any) => s.orig && s.dest)).toEqual([]);
	});

	it('ends the run on one wrong move, without unlearning anything', async () => {
		render(Mastery, { props: { data: masteryData() } });
		await fireEvent.click(screen.getAllByText('Start run')[0]);

		playMove('d2', 'd4');
		await vi.advanceTimersByTimeAsync(0);

		expect(screen.getByText(/Run ended/i)).toBeTruthy();
		expect(screen.getByText(/Nothing was unlearned/i)).toBeTruthy();
		// Crucially: no demotion call, and no mastery recorded.
		expect(fetchMock).not.toHaveBeenCalled();
		expect(screen.getByText(/Start the chapter again/i)).toBeTruthy();
	});

	it('records mastery only after every line in the chapter is played cleanly', async () => {
		render(Mastery, { props: { data: masteryData() } });
		await fireEvent.click(screen.getAllByText('Start run')[0]);

		// Line 1 of 2.
		playMove('e2', 'e4');
		await vi.advanceTimersByTimeAsync(400);
		playMove('g1', 'f3');
		await vi.advanceTimersByTimeAsync(400);
		expect(fetchMock).not.toHaveBeenCalled(); // not yet — one line to go

		// Line 2 of 2.
		playMove('e2', 'e4');
		await vi.advanceTimersByTimeAsync(400);

		expect(fetchMock).toHaveBeenCalledWith(
			'/api/practice/mastery-run',
			expect.objectContaining({ method: 'POST' })
		);
		expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ repertoireId: 'r1', chapterName: 'Open' });
		expect(screen.getByText(/Open mastered/i)).toBeTruthy();
	});

	it('says so plainly when a completed run could not be saved', async () => {
		fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });
		render(Mastery, { props: { data: masteryData({ queues: { Open: [{ variationKey: 'b', path: LINE_B }] } }) } });
		await fireEvent.click(screen.getAllByText('Start run')[0]);

		playMove('e2', 'e4');
		await vi.advanceTimersByTimeAsync(400);

		// The run was completed, so the celebration stands — but the failure to
		// record it must not be hidden behind mastery the next load will contradict.
		expect(screen.getByText(/Open mastered/i)).toBeTruthy();
		expect(screen.getByText(/couldn't save it/i)).toBeTruthy();
	});

	it('shows the repertoire-mastered banner once every chapter is mastered', () => {
		render(
			Mastery,
			{
				props: {
					data: masteryData({
						chapters: [{ chapter: 'Open', total: 2, learned: 2, canRun: true, mastered: true }],
						allMastered: true
					})
				}
			}
		);
		expect(screen.getByText(/Repertoire mastered/i)).toBeTruthy();
		expect(screen.getByText('Run again')).toBeTruthy();
	});
});
