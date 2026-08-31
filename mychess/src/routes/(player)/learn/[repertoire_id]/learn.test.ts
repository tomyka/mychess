// @vitest-environment jsdom
// mychess/src/routes/(player)/learn/[repertoire_id]/learn.test.ts
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/svelte';

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
import { setEngineEnabled } from '$lib/engine/engine.svelte';

/** Plays a move on the board currently rendered, as chessground would report it. */
function playMove(from: string, to: string) {
	cgMock.boards[cgMock.boards.length - 1].config.movable.events.after(from, to);
}

beforeEach(() => {
	cgMock.boards.length = 0;
	// The permanent desktop rail (#93) fetches its own variation list
	// unconditionally on mount, independent of anything a given test is
	// actually exercising. Only that one endpoint is given a real response —
	// everything else (e.g. /api/practice/attempt) still rejects exactly as
	// an unmocked fetch to a relative URL always has in this suite, which the
	// page's own try/catch already tolerates (see reportAttempt). Tests that
	// care about the picker's own data override this with their own
	// vi.stubGlobal('fetch', ...), same as before.
	vi.stubGlobal(
		'fetch',
		vi.fn((url: string) =>
			typeof url === 'string' && url.includes('/variations')
				? Promise.resolve({ ok: true, json: async () => [] })
				: Promise.reject(new Error(`unmocked fetch in this test: ${url}`))
		)
	);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.useRealTimers();
	setEngineEnabled(false);
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

	describe('selecting a variation from the desktop picker (GitHub issue #170)', () => {
		const v1Attempt = {
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
		};
		// A genuinely different opening (own moveIds, own starting position) —
		// not a sibling sharing a prefix with v1, so this isolates whether
		// selection itself works from whether shared-prefix content merely
		// LOOKS unchanged (see the investigation behind issue #170).
		const v2Attempt = {
			variationKey: 'v2',
			path: [
				{
					moveId: 'n1',
					san: 'd4',
					fromFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
					toFen: 'rnbqkbnr/pppppppp/8/3p4/8/8/PPP1PPPP/RNBQKBNR w KQkq - 0 1',
					isPlayerTurn: true
				}
			]
		};

		function stubFetch() {
			return vi.fn((url: string) => {
				if (typeof url === 'string' && url.includes('/variations')) {
					return Promise.resolve({
						ok: true,
						json: async () => [
							{
								variationKey: 'v1',
								label: '1.e4',
								includedByChapter: { 'Open Games': true },
								chapterNames: ['Open Games'],
								path: v1Attempt.path,
								solved: false,
								locked: false,
								ceilingMoveCount: Infinity
							},
							{
								variationKey: 'v2',
								label: '1.d4',
								includedByChapter: { "Queen's Pawn": true },
								chapterNames: ["Queen's Pawn"],
								path: v2Attempt.path,
								solved: false,
								locked: false,
								ceilingMoveCount: Infinity
							}
						]
					});
				}
				if (typeof url === 'string' && url.includes('/api/practice/select-variation')) {
					return Promise.resolve({
						ok: true,
						json: async () => ({ attempt: v2Attempt, solved: 0, total: 2, allSolved: false })
					});
				}
				return Promise.reject(new Error(`unmocked fetch in this test: ${url}`));
			});
		}

		it('selecting a genuinely different variation actually changes the served attempt and board', async () => {
			vi.stubGlobal('fetch', stubFetch());
			render(Practice, {
				props: {
					data: {
						repertoire: { id: 'r1', name: 'Test Repertoire', color: 'white' },
						solved: 0,
						total: 2,
						allSolved: false,
						attempt: v1Attempt
					}
				}
			});

			// Board initially reflects v1's starting position.
			expect(cgMock.boards[cgMock.boards.length - 1].config.fen).toBe(v1Attempt.path[0].fromFen);

			// The desktop rail auto-opens straight to v1's own chapter (only
			// member of "Open Games") — back out to the chapter list to reach
			// the other chapter's variation.
			await waitFor(() => screen.getByText('← Back'));
			await fireEvent.click(screen.getByText('← Back'));
			await fireEvent.click(screen.getByText("Queen's Pawn"));
			await fireEvent.click(screen.getByText('1.d4'));

			await waitFor(() => {
				expect(cgMock.boards[cgMock.boards.length - 1].config.fen).toBe(v2Attempt.path[0].fromFen);
			});
		});

		it('shows an error and leaves the board unchanged when the select-variation request fails', async () => {
			vi.stubGlobal(
				'fetch',
				vi.fn((url: string) => {
					if (typeof url === 'string' && url.includes('/variations')) {
						return Promise.resolve({
							ok: true,
							json: async () => [
								{
									variationKey: 'v1',
									label: '1.e4',
									includedByChapter: { 'Open Games': true },
									chapterNames: ['Open Games'],
									path: v1Attempt.path,
									solved: false,
									locked: false,
									ceilingMoveCount: Infinity
								},
								{
									variationKey: 'v2',
									label: '1.d4',
									includedByChapter: { "Queen's Pawn": true },
									chapterNames: ["Queen's Pawn"],
									path: v2Attempt.path,
									solved: false,
									locked: true, // tier-locked -> select-variation 403s
									ceilingMoveCount: Infinity
								}
							]
						});
					}
					if (typeof url === 'string' && url.includes('/api/practice/select-variation')) {
						return Promise.resolve({ ok: false, status: 403 });
					}
					return Promise.reject(new Error(`unmocked fetch in this test: ${url}`));
				})
			);
			render(Practice, {
				props: {
					data: {
						repertoire: { id: 'r1', name: 'Test Repertoire', color: 'white' },
						solved: 0,
						total: 2,
						allSolved: false,
						attempt: v1Attempt
					}
				}
			});

			await waitFor(() => screen.getByText('← Back'));
			await fireEvent.click(screen.getByText('← Back'));
			await fireEvent.click(screen.getByText("Queen's Pawn"));
			// v2 is locked, so its own leaf row is disabled — the chapter-click
			// auto-select is what actually fires the (failing) request here.

			await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
			// Board stays on v1 — the failed request never got applied.
			expect(cgMock.boards[cgMock.boards.length - 1].config.fen).toBe(v1Attempt.path[0].fromFen);
		});

		it('clicking a chapter in the mobile modal selects its representative but keeps the modal open', async () => {
			vi.stubGlobal('fetch', stubFetch());
			render(Practice, {
				props: {
					data: {
						repertoire: { id: 'r1', name: 'Test Repertoire', color: 'white' },
						solved: 0,
						total: 2,
						allSolved: false,
						attempt: v1Attempt
					}
				}
			});

			await fireEvent.click(screen.getByText('Switch variation'));
			await waitFor(() => screen.getByLabelText('Close'));
			// The modal picker doesn't auto-open to the active chapter the way
			// the inline rail does, so both chapters are already visible.
			await fireEvent.click(screen.getByText("Queen's Pawn"));

			await waitFor(() => {
				expect(cgMock.boards[cgMock.boards.length - 1].config.fen).toBe(v2Attempt.path[0].fromFen);
			});
			// Still open — a chapter click auto-selects but doesn't commit the
			// way picking a specific variation does.
			expect(screen.getByLabelText('Close')).toBeTruthy();
		});
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

		// Two copies of the nav row exist now (mobile under the board, desktop in
		// the sidebar footer — CSS picks one per viewport); jsdom applies no CSS,
		// so both are "visible" here and either one drives the same shared state.
		const back = screen.getAllByLabelText('Move back')[0] as HTMLButtonElement;
		const forward = screen.getAllByLabelText('Move forward')[0] as HTMLButtonElement;
		const toLive = screen.getAllByLabelText('Jump to current position')[0] as HTMLButtonElement;

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
		expect(screen.getAllByText('1 / 2').length).toBe(2);
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

		const forward = screen.getAllByLabelText('Move forward')[0] as HTMLButtonElement;
		const toLive = screen.getAllByLabelText('Jump to current position')[0] as HTMLButtonElement;

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
			vi.fn().mockImplementation((url: string) => {
				// The rail's own /variations fetch shares this stub too — it
				// needs an array, not RETEST_VIEW's PracticeView shape.
				if (typeof url === 'string' && url.includes('/variations')) {
					return Promise.resolve({ ok: true, json: async () => [] });
				}
				return report === 'hang' ? new Promise(() => {}) : Promise.resolve({ ok: true, json: async () => RETEST_VIEW });
			})
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

		// Visible with zero wrong attempts — no three-strikes wait. One button
		// now: the status strip above the board is the only place it's offered
		// (#167 removed the desktop sidebar's separate Stuck? panel).
		const hintButton = screen.getByText('Need a hint?');

		await fireEvent.click(hintButton);

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
		// The strip goes blank rather than explaining itself (#167): the arrow
		// is already showing the move, so there's nothing left to say about it.
		expect(screen.getByRole('status').textContent?.trim()).toBe('');
	});

	it('draws the hint even when the player had stepped back through the line', async () => {
		vi.useFakeTimers();
		renderAttempt({ ...AUTO_PLAY_ATTEMPT, arrowPlies: null, isFinalPass: true });
		await vi.advanceTimersByTimeAsync(AUTO_PLAY_INTRO_MS); // autoplay intro finishes

		// Browsing back puts the board on a past position, where the ring has
		// nothing correct to point at — so the hint has to return to the live
		// position rather than silently do nothing (#113 follow-up).
		await fireEvent.click(screen.getAllByLabelText('Move back')[0]);
		await fireEvent.click(screen.getAllByText('Need a hint?')[0]);

		expect(screen.getByLabelText('Hint: move this piece')).toBeTruthy();
		// Back on the live position, so the board is playable again.
		expect((screen.getAllByLabelText('Jump to current position')[0] as HTMLButtonElement).disabled).toBe(
			true
		);
	});

	// #125: the whole point of explore mode is that it costs the drill nothing.
	// These drive the real page through an excursion and then check the drill is
	// exactly where it was — same ply, same position, still able to solve.
	it('lets the player go off-book and come back with the attempt untouched', async () => {
		vi.useFakeTimers();
		// 'hang' holds the report open so the optimistic solved bump stays on
		// screen to be asserted, as in the final-pass test above.
		renderAttempt({ ...AUTO_PLAY_ATTEMPT, arrowPlies: null, isFinalPass: true }, 'hang');
		await vi.advanceTimersByTimeAsync(AUTO_PLAY_INTRO_MS);

		const fenBefore = cgMock.boards[cgMock.boards.length - 1].config.fen;
		await fireEvent.click(screen.getAllByRole('button', { name: 'Explore this position' })[0]);

		expect(screen.getByText(/Exploring — nothing counts here/i)).toBeTruthy();
		// A move that would be WRONG in the drill is simply legal here.
		playMove('b1', 'c3');
		await vi.advanceTimersByTimeAsync(0);
		expect(screen.queryByText(/Not that move/i)).toBeNull();
		expect(screen.queryByText(/1 mistake this attempt/i)).toBeNull();

		await fireEvent.click(screen.getAllByText(/Back to the line/i)[0]);
		expect(screen.queryByText(/Exploring/i)).toBeNull();
		expect(cgMock.boards[cgMock.boards.length - 1].config.fen).toBe(fenBefore);

		// And the drill still works: the book move solves the (final) pass.
		// And the drill still works afterwards: the book move lands on the same
		// board the excursion was played on, and solves the (final) pass.
		playMove('g1', 'f3');
		await vi.advanceTimersByTimeAsync(500);
		expect(screen.getAllByText('1 / 1 variations learned').length).toBe(2);
	});

	it('undoes explored moves one at a time', async () => {
		vi.useFakeTimers();
		renderAttempt({ ...AUTO_PLAY_ATTEMPT, arrowPlies: null, isFinalPass: true });
		await vi.advanceTimersByTimeAsync(AUTO_PLAY_INTRO_MS);

		const fenBefore = cgMock.boards[cgMock.boards.length - 1].config.fen;
		await fireEvent.click(screen.getAllByRole('button', { name: 'Explore this position' })[0]);

		const undo = screen.getAllByText(/Undo/i)[0];
		expect((undo as HTMLButtonElement).disabled).toBe(true); // nothing to undo yet

		playMove('b1', 'c3');
		await vi.advanceTimersByTimeAsync(0);
		expect((screen.getAllByText(/Undo/i)[0] as HTMLButtonElement).disabled).toBe(false);

		await fireEvent.click(screen.getAllByText(/Undo/i)[0]);
		expect(cgMock.boards[cgMock.boards.length - 1].config.fen).toBe(fenBefore);
	});

	// Explore is about "the position the drill is asking about", which is not a
	// well-defined thing mid-autoplay or while looking back at an earlier ply.
	it('disables (but keeps visible) explore during the autoplay intro', () => {
		vi.useFakeTimers();
		renderAttempt(AUTO_PLAY_ATTEMPT);
		const button = screen.getAllByRole('button', { name: 'Explore this position' })[0] as HTMLButtonElement;
		expect(button.disabled).toBe(true);
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

	// The engine is no longer part of drilling at all: Learn repeats a line, and
	// an evaluation on screen invites judging the position instead of recalling
	// the move. There is no bar, and nothing downloads an engine.
	it('shows no eval bar while drilling', async () => {
		vi.useFakeTimers();
		const WorkerSpy = vi.fn();
		vi.stubGlobal('Worker', WorkerSpy);
		renderAttempt({ ...AUTO_PLAY_ATTEMPT, arrowPlies: null, isFinalPass: true });
		await vi.advanceTimersByTimeAsync(AUTO_PLAY_INTRO_MS);

		expect(screen.queryByRole('img', { name: /Engine evaluation/i })).toBeNull();
		expect(screen.queryByRole('button', { name: /engine/i })).toBeNull();
		expect(WorkerSpy).not.toHaveBeenCalled();
	});

	// Explore is where analysis belongs — but the toggle starts off, so the bar
	// (and the ~5.5MB download behind it) waits to be asked for.
	it('offers the engine in explore mode, switched off, with no bar yet', async () => {
		vi.useFakeTimers();
		renderAttempt({ ...AUTO_PLAY_ATTEMPT, arrowPlies: null, isFinalPass: true });
		await vi.advanceTimersByTimeAsync(AUTO_PLAY_INTRO_MS);
		await fireEvent.click(screen.getAllByRole('button', { name: 'Explore this position' })[0]);

		const toggle = screen.getAllByRole('button', { name: /engine/i })[0];
		expect(toggle.getAttribute('aria-pressed')).toBe('false');
		expect(screen.queryByRole('img', { name: /Engine evaluation/i })).toBeNull();
	});

	// Pressed, the bar appears. jsdom has no Worker, so the engine can only
	// fail — which is exactly what the bar must survive: it says so and stays.
	// Pressed again it unmounts, which is what keeps the flag and the worker in
	// lockstep (EvalBar tears the worker down as its last instance unmounts).
	it('shows the bar once the engine is switched on, and drops it when switched off', async () => {
		vi.useFakeTimers();
		renderAttempt({ ...AUTO_PLAY_ATTEMPT, arrowPlies: null, isFinalPass: true });
		await vi.advanceTimersByTimeAsync(AUTO_PLAY_INTRO_MS);
		await fireEvent.click(screen.getAllByRole('button', { name: 'Explore this position' })[0]);
		await fireEvent.click(screen.getAllByRole('button', { name: /engine/i })[0]);

		const bar = screen.getByRole('img', { name: /Engine evaluation/i });
		expect(bar.getAttribute('aria-label')).toBe('Engine evaluation unavailable');
		expect(screen.getAllByRole('button', { name: /engine/i })[0].getAttribute('aria-pressed')).toBe('true');

		await fireEvent.click(screen.getAllByRole('button', { name: /engine/i })[0]);
		expect(screen.queryByRole('img', { name: /Engine evaluation/i })).toBeNull();
	});
});
