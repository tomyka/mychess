// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import Practice from './+page.svelte';

afterEach(() => cleanup());

describe('practice detail page', () => {
	it('shows "nothing to practice" rather than "mastered" when the repertoire has no moves yet', () => {
		render(Practice, {
			props: {
				data: {
					repertoire: { id: 'r1', name: 'Empty Repertoire', color: 'white' },
					level: 'mastered',
					totalVariations: 0,
					satisfiedCount: 0,
					attempt: null
				}
			}
		});
		expect(screen.queryByText(/Repertoire Mastered/i)).toBeNull();
		expect(screen.getByText(/Nothing to practice/i)).toBeTruthy();
	});

	it('shows the mastered screen once every real variation is actually solved', () => {
		render(Practice, {
			props: {
				data: {
					repertoire: { id: 'r1', name: 'French Defense', color: 'white' },
					level: 'mastered',
					totalVariations: 5,
					satisfiedCount: 5,
					attempt: null
				}
			}
		});
		expect(screen.getByText(/Repertoire Mastered/i)).toBeTruthy();
	});

	it('shows the current level and progress while an attempt is in flight', () => {
		render(Practice, {
			props: {
				data: {
					repertoire: { id: 'r1', name: 'French Defense', color: 'white' },
					level: 2,
					totalVariations: 5,
					satisfiedCount: 3,
					attempt: {
						prefix: [
							{
								moveId: 'm1',
								san: 'e4',
								fromFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
								toFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
								isPlayerTurn: true
							},
							{
								moveId: 'm2',
								san: 'e5',
								fromFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
								toFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
								isPlayerTurn: false
							}
						],
						quizSteps: [
							{
								moveId: 'm3',
								san: 'Nf3',
								fromFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
								toFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
								isPlayerTurn: true
							}
						]
					}
				}
			}
		});
		expect(screen.getByText(/Level 2/i)).toBeTruthy();
		expect(screen.getByText(/3\/5 solved/i)).toBeTruthy();
	});
});
