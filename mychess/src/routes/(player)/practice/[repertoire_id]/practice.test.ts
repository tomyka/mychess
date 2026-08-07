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
					totalLevels: 0,
					satisfiedCount: 0,
					attempt: null,
					reviewLevel: null
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
					totalLevels: 3,
					satisfiedCount: 5,
					attempt: null,
					reviewLevel: null
				}
			}
		});
		expect(screen.getByText(/Repertoire Mastered/i)).toBeTruthy();
	});

	it('also shows the level list on the mastered screen', () => {
		render(Practice, {
			props: {
				data: {
					repertoire: { id: 'r1', name: 'French Defense', color: 'white' },
					level: 'mastered',
					totalVariations: 5,
					totalLevels: 3,
					satisfiedCount: 5,
					attempt: null,
					reviewLevel: null
				}
			}
		});
		expect(screen.getByText(/Repertoire Mastered/i)).toBeTruthy();
		expect(screen.getByText(/Level 1/i)).toBeTruthy();
	});

	it('shows the current level and progress while an attempt is in flight', () => {
		render(Practice, {
			props: {
				data: {
					repertoire: { id: 'r1', name: 'French Defense', color: 'white' },
					level: 2,
					totalVariations: 5,
					totalLevels: 4,
					satisfiedCount: 3,
					levelTaskCount: 5,
					levelSolvedCount: 3,
					reviewLevel: null,
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
		expect(screen.getByText(/Level 2 of 4/i)).toBeTruthy();
		expect(screen.getByText(/3\/5 solved/i)).toBeTruthy();
	});

	it('shows the reviewing banner and exit control when reviewing a past level', () => {
		render(Practice, {
			props: {
				data: {
					repertoire: { id: 'r1', name: 'French Defense', color: 'white' },
					level: 3,
					totalVariations: 5,
					totalLevels: 4,
					satisfiedCount: 3,
					reviewLevel: 2,
					attempt: {
						prefix: [
							{
								moveId: 'm1',
								san: 'e4',
								fromFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
								toFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
								isPlayerTurn: true
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
		expect(screen.getByText(/Reviewing Level 2/i)).toBeTruthy();
		expect(screen.getByText(/Exit review/i)).toBeTruthy();
	});

	it('shows "Mastered" (not "Level mastered") in the sidebar card when reviewing a level on an already-mastered repertoire', () => {
		render(Practice, {
			props: {
				data: {
					repertoire: { id: 'r1', name: 'French Defense', color: 'white' },
					level: 'mastered',
					totalVariations: 5,
					totalLevels: 4,
					satisfiedCount: 5,
					reviewLevel: 2,
					attempt: {
						prefix: [
							{
								moveId: 'm1',
								san: 'e4',
								fromFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
								toFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
								isPlayerTurn: true
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
		expect(screen.queryByText(/Level mastered/i)).toBeNull();
		// The sidebar progress card interpolates the repertoire name and "Mastered"
		// into the same <p>, so matching that combination disambiguates it from
		// LevelList's own "🏆 Mastered" row (which has no repertoire name nearby).
		expect(screen.getByText(/French Defense.*Mastered/i)).toBeTruthy();
	});
});
