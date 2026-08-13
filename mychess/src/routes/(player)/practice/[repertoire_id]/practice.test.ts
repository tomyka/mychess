// @vitest-environment jsdom
// mychess/src/routes/(player)/practice/[repertoire_id]/practice.test.ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';
import Practice from './+page.svelte';

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

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
});
