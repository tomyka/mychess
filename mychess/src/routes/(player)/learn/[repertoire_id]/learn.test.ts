// @vitest-environment jsdom
// mychess/src/routes/(player)/learn/[repertoire_id]/learn.test.ts
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';

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
	cgMock.boards.length = 0;
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

// Long enough to clear AUTO_PLAY_ATTEMPT's 2-ply autoplay intro at the page's
// own AUTO_PLAY_STEP_MS (700ms per ply, deliberately unhurried) plus slack.
const AUTO_PLAY_INTRO_MS = 2000;

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

describe('learn detail page', () => {
	it('shows "nothing to learn" when the repertoire has no moves yet', () => {
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
		expect(screen.queryByText(/Repertoire learned/i)).toBeNull();
		expect(screen.getByText(/Nothing to learn/i)).toBeTruthy();
	});

	it('shows the "Repertoire learned!" screen once every variation is learned', () => {
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
		expect(screen.getByText(/Repertoire learned/i)).toBeTruthy();
		expect(screen.getByText('Re-drill a specific variation')).toBeTruthy();
	});

	it('shows the board, not the learned screen, when re-drilling a variation from a completed repertoire', () => {
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
		expect(screen.queryByText(/Repertoire learned/i)).toBeNull();
		// The practice chrome renders instead (name appears once in the header).
		expect(screen.getAllByText('French Defense').length).toBe(1);
		expect(screen.getAllByText('5 / 5 variations learned').length).toBe(2);
	});

	it('shows the repertoire name and learned/total progress while an attempt is in flight', () => {
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
		expect(screen.getAllByText('3 / 5 variations learned').length).toBe(2);
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
		await vi.advanceTimersByTimeAsync(AUTO_PLAY_INTRO_MS);
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
		await vi.advanceTimersByTimeAsync(AUTO_PLAY_INTRO_MS); // autoplay intro finishes, quizIdx lands at 2

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

	// Counted in the player's OWN moves, not plies: 4 plies here, two of them the
	// player's, and the auto-played opponent reply must not advance the counter.
	it('shows the current position in the nav row, counted in player moves', async () => {
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
		await vi.advanceTimersByTimeAsync(AUTO_PLAY_INTRO_MS); // autoplay intro finishes, quizIdx lands at 2
		expect(screen.getByText('1 / 2')).toBeTruthy();
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
		await vi.advanceTimersByTimeAsync(AUTO_PLAY_INTRO_MS); // autoplay intro finishes, quizIdx lands at 2

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
		await vi.advanceTimersByTimeAsync(AUTO_PLAY_INTRO_MS);
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
		await vi.advanceTimersByTimeAsync(AUTO_PLAY_INTRO_MS); // autoplay intro finishes on the taught batch

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
		await vi.advanceTimersByTimeAsync(AUTO_PLAY_INTRO_MS);
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
		await vi.advanceTimersByTimeAsync(AUTO_PLAY_INTRO_MS);
		playMove('g1', 'f3');
		await vi.advanceTimersByTimeAsync(500);

		// The optimistic solved bump fires only for a FINAL pass, so seeing the
		// count move is proof this really was played out as one — the missing cue
		// below isn't just a move that failed to land.
		expect(screen.getAllByText('1 / 1 variations learned').length).toBe(2);
		expect(phaseNow()).toBe('advancing');
		expect(screen.queryByText(/now play it from memory/i)).toBeNull();
	});

	it('does not cue a teach pass that had a mistake — the same taught batch comes back, not a blind test', async () => {
		vi.useFakeTimers();
		renderAttempt(AUTO_PLAY_ATTEMPT, 'hang');
		await vi.advanceTimersByTimeAsync(AUTO_PLAY_INTRO_MS);

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

	it('offers a hint immediately, and taking it prevents the pass from counting as a clean pass', async () => {
		vi.useFakeTimers();
		renderAttempt({ ...AUTO_PLAY_ATTEMPT, arrowPlies: null, isFinalPass: true });
		await vi.advanceTimersByTimeAsync(AUTO_PLAY_INTRO_MS); // autoplay intro finishes

		// Visible with zero wrong attempts — no three-strikes wait.
		const hintButtons = screen.getAllByText('Need a hint?');
		expect(hintButtons.length).toBe(2);

		await fireEvent.click(hintButtons[0]);

		// What the player must actually SEE for the tap to have done anything:
		// the amber ring + 💡 badge over the piece to move (#113 follow-up —
		// "pressed Need a hint and nothing happened").
		expect(screen.getByLabelText('Hint: move this piece')).toBeTruthy();

		playMove('g1', 'f3'); // the correct move — but the hint already marked this pass dirty
		await vi.advanceTimersByTimeAsync(500);

		// A dirty final pass must not bump solved (optimisticSolvedAfterAttempt(hadMistake=true)).
		expect(screen.getAllByText('0 / 1 variations learned').length).toBe(2);
	});

	it('offers no hint on a ply whose move is already drawn as a teaching arrow', async () => {
		vi.useFakeTimers();
		// arrowPlies covers plies 2-4, and autoPlayThrough lands the board on
		// ply 2 — so the move being asked for is the one under the arrow.
		renderAttempt(AUTO_PLAY_ATTEMPT);
		await vi.advanceTimersByTimeAsync(AUTO_PLAY_INTRO_MS);

		expect(screen.queryByText('Need a hint?')).toBeNull();
		// Said instead of an empty "Stuck?" block on the desktop sidebar.
		expect(screen.getByText(/This move is being shown/i)).toBeTruthy();
	});

	it('draws the hint even when the player had stepped back through the line', async () => {
		vi.useFakeTimers();
		renderAttempt({ ...AUTO_PLAY_ATTEMPT, arrowPlies: null, isFinalPass: true });
		await vi.advanceTimersByTimeAsync(AUTO_PLAY_INTRO_MS); // autoplay intro finishes

		// Browsing back puts the board on a past position, where the ring has
		// nothing correct to point at — so the hint has to return to the live
		// position rather than silently do nothing (#113 follow-up).
		await fireEvent.click(screen.getByLabelText('Move back'));
		await fireEvent.click(screen.getAllByText('Need a hint?')[0]);

		expect(screen.getByLabelText('Hint: move this piece')).toBeTruthy();
		// Back on the live position, so the board is playable again.
		expect((screen.getByLabelText('Jump to current position') as HTMLButtonElement).disabled).toBe(
			true
		);
	});

	it('shows a running session count and a Finish session link in the sidebar', () => {
		render(Practice, {
			props: {
				data: {
					repertoire: { id: 'r1', name: 'French Defense', color: 'white' },
					solved: 0,
					total: 1,
					allSolved: false,
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
		expect(screen.getByText('0 learned this session')).toBeTruthy();
		expect(screen.getByRole('link', { name: 'Finish session' })).toBeTruthy();
	});

	it('shows a mistakes-this-attempt chip in the sidebar after a wrong move', async () => {
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
		await vi.advanceTimersByTimeAsync(AUTO_PLAY_INTRO_MS); // autoplay intro finishes

		expect(screen.queryByText(/mistake/i)).toBeNull();

		playMove('b1', 'c3'); // wrong: the book move is Nf3
		await vi.advanceTimersByTimeAsync(500);

		expect(screen.getByText('1 mistake this attempt')).toBeTruthy();
	});

	// The engine has no toggle any more (it is always on), and jsdom has no
	// Worker at all — so what matters here is that the page still renders and the
	// eval bar is present and honest about having nothing to show.
	it('renders the eval bar, and survives the engine being unavailable (no Worker in jsdom)', () => {
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
		const bar = screen.getByRole('img', { name: /Engine evaluation/i });
		expect(bar.getAttribute('aria-label')).toBe('Engine evaluation unavailable');
		expect(screen.queryByRole('switch', { name: 'Toggle engine evaluation' })).toBeNull();
		expect(screen.getAllByText('French Defense').length).toBe(1);
	});
});
