// @vitest-environment jsdom
// mychess/src/routes/(player)/practice/[repertoire_id]/practice.test.ts
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';
import { enginePrefStore } from '$lib/enginePref.svelte';

// Chessground is faked so a test can actually PLAY a move. It can't be driven
// through the DOM here: every one of its input paths goes through
// `drag.start`, which bails on `!e.isTrusted`, and jsdom's synthetic events
// are untrusted by definition (`isTrusted` is an own, non-configurable
// property on every event instance — unspoofable). So the third-party board
// is replaced by a shell that just remembers the last config ChessBoard
// handed it, and `playMove` invokes that config's own
// `movable.events.after` — the exact callback chessground itself would call
// after a real drag. Everything above that (ChessBoard's move validation and
// feedback badges, the practice page's whole phase machine) is the real
// thing, not a stub.
const cgMock = vi.hoisted(() => ({ boards: [] as { config: any }[] }));

vi.mock('chessground', () => ({
	Chessground: (_node: HTMLElement, config: any) => {
		const entry = { config };
		cgMock.boards.push(entry);
		return {
			// ChessBoard only ever partially updates (`cg.set({ drawable })`)
			// or replaces the whole config (`cg.set(buildConfig())`), so a
			// shallow merge is enough to keep `movable.events.after` current.
			set: (cfg: any) => {
				entry.config = { ...entry.config, ...cfg };
			},
			destroy: () => {}
		};
	}
}));

import Practice from './+page.svelte';

/** Plays a move on the board currently rendered, as chessground would report it. */
function playMove(from: string, to: string) {
	cgMock.boards[cgMock.boards.length - 1].config.movable.events.after(from, to);
}

beforeEach(() => {
	// enginePrefStore is a module-level singleton shared across every test
	// in this file (and every other file importing it in the same
	// process) — reset it explicitly rather than relying on it starting
	// fresh.
	enginePrefStore.enabled = false;
	cgMock.boards.length = 0;
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

	it('shows the board, not the solved screen, when re-drilling a variation from a completed repertoire', () => {
		// Regression: picking a variation to re-drill deliberately does NOT
		// un-solve anything, so `allSolved` stays true. The server signals the
		// re-drill by returning a real `attempt` anyway
		// (/api/practice/select-variation passes forceAttempt: true, which makes
		// buildPracticeView build one despite the repertoire being complete).
		// The template used to branch on `allSolved` alone, so the trophy screen
		// kept winning and "Re-drill a specific variation" appeared to do
		// nothing at all.
		render(Practice, {
			props: {
				data: {
					repertoire: { id: 'r1', name: 'French Defense', color: 'white' },
					solved: 5,
					total: 5,
					allSolved: true,
					attempt: {
						variationKey: 'v1',
						path: [
							{
								moveId: 'm1',
								san: 'e4',
								fromFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
								toFen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
								isPlayerTurn: true
							}
						]
					}
				}
			}
		});
		expect(screen.queryByText(/Repertoire Solved/i)).toBeNull();
		// The practice chrome renders instead (name appears once in the header).
		expect(screen.getAllByText('French Defense').length).toBe(1);
		expect(screen.getAllByText('5 / 5 variations solved').length).toBe(2);
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
		// The repertoire name renders once in the header; progress renders
		// twice (mobile card + desktop sidebar).
		expect(screen.getAllByText('French Defense').length).toBe(1);
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

	it('shows the current ply position in the nav row', async () => {
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
		expect(screen.getByText('2 / 4')).toBeTruthy();
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

	// AUTO_PLAY_ATTEMPT is a teach pass: plies 0-1 are already mastered (they
	// auto-play), and the arrowed batch is the player's Nf3 at ply 2. Nf3 is
	// therefore the pass's last player move — playing it correctly completes a
	// clean teach pass, which is exactly the moment the blind retest gets
	// demanded.
	const RETEST_VIEW = {
		solved: 0,
		total: 1,
		allSolved: false,
		attempt: { ...AUTO_PLAY_ATTEMPT, arrowPlies: null }
	};

	/**
	 * `report: 'hang'` leaves the attempt-completion POST pending forever, which
	 * parks the page in the phase it reaches right after the final move instead
	 * of letting it roll on into the next attempt — the only way to inspect that
	 * moment deterministically.
	 */
	function renderAttempt(attempt: unknown, report: 'reset' | 'hang' = 'reset') {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockImplementation(() =>
				report === 'hang' ? new Promise(() => {}) : Promise.resolve({ ok: true, json: async () => RETEST_VIEW })
			)
		);
		render(Practice, {
			props: {
				data: { repertoire: { id: 'r1', name: 'French Defense', color: 'white' }, solved: 0, total: 1, allSolved: false, attempt }
			}
		});
	}

	const phaseNow = () => document.querySelector('main')?.getAttribute('data-phase');

	it('cues "now play it from memory" when a clean teach pass ends, BEFORE the board resets for the blind retest', async () => {
		vi.useFakeTimers();
		renderAttempt(AUTO_PLAY_ATTEMPT);
		await vi.advanceTimersByTimeAsync(1000); // autoplay intro finishes on the taught batch

		playMove('g1', 'f3');
		await vi.advanceTimersByTimeAsync(500); // the correct-move hold

		expect(screen.getByText(/now play it from memory/i)).toBeTruthy();
		// 'transition' is still the FINISHED pass: nextAttempt() hasn't run, so
		// nothing has rewound the board yet — the cue lands ahead of the reset,
		// not after it.
		expect(phaseNow()).toBe('transition');
	});

	it('keeps the cue up across the reset it is explaining, then retires it on its own', async () => {
		vi.useFakeTimers();
		renderAttempt(AUTO_PLAY_ATTEMPT);
		await vi.advanceTimersByTimeAsync(1000);
		playMove('g1', 'f3');
		await vi.advanceTimersByTimeAsync(500 + 1200 + 50); // hold, cue hold, next attempt loads

		expect(phaseNow()).not.toBe('transition'); // the blind retest is now up
		expect(screen.getByText(/now play it from memory/i)).toBeTruthy();

		await vi.advanceTimersByTimeAsync(2000);
		expect(screen.queryByText(/now play it from memory/i)).toBeNull();
	});

	it('does not cue a final pass — that solves the variation instead of re-asking for it', async () => {
		vi.useFakeTimers();
		renderAttempt({ ...AUTO_PLAY_ATTEMPT, arrowPlies: null, isFinalPass: true }, 'hang');
		await vi.advanceTimersByTimeAsync(1000);
		playMove('g1', 'f3');
		await vi.advanceTimersByTimeAsync(500);

		// The optimistic solved bump fires only for a FINAL pass, so seeing the
		// count move is proof this really was played out as one — the missing cue
		// below isn't just a move that failed to land.
		expect(screen.getAllByText('1 / 1 variations solved').length).toBe(2);
		expect(phaseNow()).toBe('advancing');
		expect(screen.queryByText(/now play it from memory/i)).toBeNull();
	});

	it('does not cue a teach pass that had a mistake — the same taught batch comes back, not a blind test', async () => {
		vi.useFakeTimers();
		renderAttempt(AUTO_PLAY_ATTEMPT, 'hang');
		await vi.advanceTimersByTimeAsync(1000);

		for (let i = 0; i < 3; i++) {
			playMove('b1', 'c3'); // Nc3, not the book's Nf3
			await vi.advanceTimersByTimeAsync(500);
		}

		playMove('g1', 'f3');
		await vi.advanceTimersByTimeAsync(500);

		// The pass still finished (it just wasn't clean), so this is a real
		// "completed without a cue", not a move that never landed.
		expect(phaseNow()).toBe('advancing');
		expect(screen.queryByText(/now play it from memory/i)).toBeNull();
	});

	it('offers a hint immediately, and taking it prevents the pass from counting as solved', async () => {
		vi.useFakeTimers();
		renderAttempt({ ...AUTO_PLAY_ATTEMPT, arrowPlies: null, isFinalPass: true });
		await vi.advanceTimersByTimeAsync(1000); // autoplay intro finishes

		// Visible with zero wrong attempts — no three-strikes wait.
		const hintButtons = screen.getAllByText('Need a hint?');
		expect(hintButtons.length).toBe(2);

		await fireEvent.click(hintButtons[0]);

		playMove('g1', 'f3'); // the correct move — but the hint already marked this pass dirty
		await vi.advanceTimersByTimeAsync(500);

		// A dirty final pass must not bump solved (optimisticSolvedAfterAttempt(hadMistake=true)).
		expect(screen.getAllByText('0 / 1 variations solved').length).toBe(2);
	});

	it('renders without crashing with the engine toggle in its default (off) state', () => {
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
		// The toggle switch itself always renders (mobile card + desktop
		// panel); off by default, it never attempts to spawn a Worker at all.
		expect(screen.getAllByRole('switch', { name: 'Toggle engine evaluation' }).length).toBe(2);
		expect(screen.getAllByText('French Defense').length).toBe(1);
	});

	it('switching the engine on flips both instances together and shows "unavailable" (jsdom has no Worker)', async () => {
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

		const switches = screen.getAllByRole('switch', { name: 'Toggle engine evaluation' });
		expect(switches.every((s) => s.getAttribute('aria-checked') === 'false')).toBe(true);

		await fireEvent.click(switches[0]);

		// Both instances (mobile card + desktop panel) share the same store, so both flip together.
		const switchesAfter = screen.getAllByRole('switch', { name: 'Toggle engine evaluation' });
		expect(switchesAfter.every((s) => s.getAttribute('aria-checked') === 'true')).toBe(true);
		// jsdom has no Worker API, so ensureWorker() immediately marks itself failed.
		expect(screen.getAllByText('unavailable').length).toBe(2);
	});
});
