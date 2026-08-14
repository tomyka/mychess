// @vitest-environment jsdom
// mychess/src/routes/(player)/practice/[repertoire_id]/practice.test.ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';
import Practice from './+page.svelte';

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

const AUTO_PLAY_ATTEMPT = {
	variationKey: 'v1',
	arrowPlies: { from: 2, to: 4 },
	isFinalPass: false,
	autoPlayThrough: 2,
	path: [
		{
			moveId: 'm1',
			san: 'e4',
			fromFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
			toFen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
			isPlayerTurn: true
		},
		{
			moveId: 'm2',
			san: 'e5',
			fromFen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
			toFen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
			isPlayerTurn: false
		},
		{
			moveId: 'm3',
			san: 'Nf3',
			fromFen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
			toFen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2',
			isPlayerTurn: true
		},
		{
			moveId: 'm4',
			san: 'Nc6',
			fromFen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2',
			toFen: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
			isPlayerTurn: false
		}
	]
};

describe('practice detail page', () => {
	it('shows "nothing to practice" when the repertoire has no moves yet', () => {
		render(Practice, {
			props: {
				data: {
					repertoire: { id: 'r1', name: 'Empty Repertoire', color: 'white' },
					attempt: null,
					solved: 0,
					total: 0,
					allSolved: false
				}
			}
		});
		expect(screen.queryByText(/Repertoire Solved/i)).toBeNull();
		expect(screen.getByText(/Nothing to practice/i)).toBeTruthy();
	});

	it('shows the "Repertoire Solved!" screen once every variation is solved', () => {
		render(Practice, {
			props: {
				data: {
					repertoire: { id: 'r1', name: 'French Defense', color: 'white' },
					attempt: null,
					solved: 5,
					total: 5,
					allSolved: true
				}
			}
		});
		expect(screen.getByText(/Repertoire Solved/i)).toBeTruthy();
		expect(screen.getByText('Re-drill a specific variation')).toBeTruthy();
	});

	it('shows the repertoire name and solved/total progress while an attempt is in flight', () => {
		render(Practice, {
			props: {
				data: {
					repertoire: { id: 'r1', name: 'French Defense', color: 'white' },
					solved: 3,
					total: 5,
					allSolved: false,
					attempt: {
						variationKey: 'v1',
						path: [
							{
								moveId: 'm1',
								san: 'e4',
								fromFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
								toFen: 'rnbqkbnr/pppppppp/8/8/8/PPPPPPPP/8/RNBQKBNR w KQkq - 0 1',
								isPlayerTurn: true
							}
						]
					}
				}
			}
		});
		expect(screen.getByText('French Defense')).toBeTruthy();
		expect(screen.getByText('3 / 5 variations solved')).toBeTruthy();
	});

	it('shows a "Choose a variation" control whenever a repertoire is loaded', () => {
		render(Practice, {
			props: {
				data: {
					repertoire: { id: 'r1', name: 'French Defense', color: 'white' },
					solved: 0,
					total: 5,
					allSolved: false,
					attempt: {
						variationKey: 'v1',
						path: [
							{
								moveId: 'm1',
								san: 'e4',
								fromFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
								toFen: 'rnbqkbnr/pppppppp/8/8/8/PPPPPPPP/8/RNBQKBNR w KQkq - 0 1',
								isPlayerTurn: true
							}
						]
					}
				}
			}
		});
		expect(screen.getByText('Choose a variation')).toBeTruthy();
	});

	it('opens the variation picker when "Choose a variation" is clicked', async () => {
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
		vi.stubGlobal('fetch', fetchSpy);
		render(Practice, {
			props: {
				data: {
					repertoire: { id: 'r1', name: 'French Defense', color: 'white' },
					solved: 0,
					total: 5,
					allSolved: false,
					attempt: {
						variationKey: 'v1',
						path: [
							{
								moveId: 'm1',
								san: 'e4',
								fromFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
								toFen: 'rnbqkbnr/pppppppp/8/8/8/PPPPPPPP/8/RNBQKBNR w KQkq - 0 1',
								isPlayerTurn: true
							}
						]
					}
				}
			}
		});
		await fireEvent.click(screen.getByText('Choose a variation'));
		// VariationPicker itself renders a "Close" control unique to it — a
		// reliable signal the picker actually mounted, without colliding with
		// the "Choose a variation" text that appears in BOTH the trigger
		// button and the picker's own heading.
		expect(screen.getByLabelText('Close')).toBeTruthy();
	});

	it('opens the variation picker when "Re-drill a specific variation" is clicked on the solved screen', async () => {
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
		vi.stubGlobal('fetch', fetchSpy);
		render(Practice, {
			props: {
				data: {
					repertoire: { id: 'r1', name: 'French Defense', color: 'white' },
					attempt: null,
					solved: 5,
					total: 5,
					allSolved: true
				}
			}
		});
		await fireEvent.click(screen.getByText('Re-drill a specific variation'));
		expect(screen.getByLabelText('Close')).toBeTruthy();
	});

	it('does not prompt for a move while the already-mastered plies before a teach batch are auto-playing', () => {
		vi.useFakeTimers();
		render(Practice, {
			props: {
				data: {
					repertoire: { id: 'r1', name: 'French Defense', color: 'white' },
					solved: 0,
					total: 1,
					allSolved: false,
					attempt: AUTO_PLAY_ATTEMPT
				}
			}
		});
		expect(screen.queryAllByText(/What is the best move/i)).toHaveLength(0);
	});

	it('prompts for a move again once the autoplay intro reaches the batch actually being taught', async () => {
		vi.useFakeTimers();
		render(Practice, {
			props: {
				data: {
					repertoire: { id: 'r1', name: 'French Defense', color: 'white' },
					solved: 0,
					total: 1,
					allSolved: false,
					attempt: AUTO_PLAY_ATTEMPT
				}
			}
		});
		// arrowPlies.from is 2 — two already-mastered plies auto-play before
		// the player is asked to move again. advanceTimersByTimeAsync (not the
		// sync version) also flushes the microtask queue between ticks, which
		// Svelte 5's reactivity needs to actually re-render.
		await vi.advanceTimersByTimeAsync(1000);
		expect(screen.queryAllByText(/What is the best move/i).length).toBeGreaterThan(0);
	});

	it('also auto-plays the already-mastered prefix during a blind retest (no arrowPlies), not just a teach pass', async () => {
		vi.useFakeTimers();
		render(Practice, {
			props: {
				data: {
					repertoire: { id: 'r1', name: 'French Defense', color: 'white' },
					solved: 0,
					total: 1,
					allSolved: false,
					attempt: { ...AUTO_PLAY_ATTEMPT, arrowPlies: null, isFinalPass: true }
				}
			}
		});
		// autoPlayThrough (2) still applies with arrowPlies null — a blind
		// retest whose leading plies are already mastered (e.g. via a sibling
		// variation sharing them) auto-plays that part just like a teach pass
		// does, and only requires the player to blind-play what's left.
		expect(screen.queryAllByText(/What is the best move/i)).toHaveLength(0);
		await vi.advanceTimersByTimeAsync(1000);
		expect(screen.queryAllByText(/What is the best move/i).length).toBeGreaterThan(0);
	});
});
