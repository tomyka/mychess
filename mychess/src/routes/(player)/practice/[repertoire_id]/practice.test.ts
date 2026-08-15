// @vitest-environment jsdom
// mychess/src/routes/(player)/practice/[repertoire_id]/practice.test.ts
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';
import Practice from './+page.svelte';
import { enginePrefStore } from '$lib/enginePref.svelte';

beforeEach(() => {
	// enginePrefStore is a module-level singleton shared across every test
	// in this file (and every other file importing it in the same
	// process) — reset it explicitly rather than relying on it starting
	// fresh.
	enginePrefStore.enabled = false;
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.useRealTimers();
	document.cookie = 'engine_enabled=; path=/; max-age=0';
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
		// The repertoire name/progress renders twice — once in the mobile card
		// above the board, once in the desktop sidebar panel — with Tailwind
		// breakpoint classes deciding which is visible; jsdom doesn't evaluate
		// those, so both are present in the DOM.
		expect(screen.getAllByText('French Defense').length).toBe(2);
		expect(screen.getAllByText('3 / 5 variations solved').length).toBe(2);
	});

	it('shows a "Switch variation" control whenever a repertoire is loaded', () => {
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
		expect(screen.getByText('Switch variation')).toBeTruthy();
	});

	it('opens the variation picker when "Switch variation" is clicked', async () => {
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
		await fireEvent.click(screen.getByText('Switch variation'));
		// VariationPicker itself renders a "Close" control unique to it — a
		// reliable signal the picker actually mounted.
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
		expect(document.querySelector('main')?.getAttribute('data-phase')).toBe('autoplay');
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
		expect(document.querySelector('main')?.getAttribute('data-phase')).toBe('playing');
	});

	it('lets the mobile move-nav browse back through the current attempt and forward again to live', async () => {
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
		await vi.advanceTimersByTimeAsync(1000); // autoplay intro finishes, quizIdx lands at 2

		const back = screen.getByLabelText('Move back') as HTMLButtonElement;
		const forward = screen.getByLabelText('Move forward') as HTMLButtonElement;
		const toLive = screen.getByLabelText('Jump to current position') as HTMLButtonElement;

		// At the live position: nothing to browse forward to yet.
		expect(forward.disabled).toBe(true);
		expect(toLive.disabled).toBe(true);

		await fireEvent.click(back);
		expect(document.querySelector('main')?.getAttribute('data-phase')).toBe('playing');
		expect(forward.disabled).toBe(false);
		expect(toLive.disabled).toBe(false);

		await fireEvent.click(toLive);
		expect(forward.disabled).toBe(true);
		expect(toLive.disabled).toBe(true);
	});

	it('lets the left/right/up/down arrow keys drive the same review nav as the buttons', async () => {
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
		await vi.advanceTimersByTimeAsync(1000); // autoplay intro finishes, quizIdx lands at 2

		const forward = screen.getByLabelText('Move forward') as HTMLButtonElement;
		const toLive = screen.getByLabelText('Jump to current position') as HTMLButtonElement;

		expect(forward.disabled).toBe(true);

		await fireEvent.keyDown(window, { key: 'ArrowLeft' });
		expect(forward.disabled).toBe(false);
		expect(toLive.disabled).toBe(false);

		await fireEvent.keyDown(window, { key: 'ArrowDown' });
		expect(forward.disabled).toBe(true);
		expect(toLive.disabled).toBe(true);
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
		expect(document.querySelector('main')?.getAttribute('data-phase')).toBe('autoplay');
		await vi.advanceTimersByTimeAsync(1000);
		expect(document.querySelector('main')?.getAttribute('data-phase')).toBe('playing');
	});

	it('renders without crashing when the engine is unavailable (jsdom has no Worker)', () => {
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
		// jsdom doesn't implement the Worker API, so EngineEval's onMount
		// catches that and marks itself failed — this just confirms the page
		// (and EngineEval within it) doesn't throw and renders the board.
		expect(screen.getAllByText('French Defense').length).toBe(2);
	});

	it('hides the engine eval until its toggle is switched on', async () => {
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

		// Off by default — no "Eval" label (EngineEval's own content) rendered anywhere yet.
		expect(screen.getAllByText('🔧 Engine: Off').length).toBe(2);
		expect(screen.queryByText('Eval')).toBeNull();

		const [toggle] = screen.getAllByText('🔧 Engine: Off');
		await fireEvent.click(toggle);

		// Both instances (mobile card + desktop panel) share the same store, so both flip together.
		expect(screen.getAllByText('🔧 Engine: On').length).toBe(2);
		expect(screen.getAllByText('Eval').length).toBe(2);
	});
});
