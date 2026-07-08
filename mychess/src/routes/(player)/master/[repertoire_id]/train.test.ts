// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import Train from './+page.svelte';

afterEach(() => cleanup());

describe('repertoire train page', () => {
	it('shows "nothing to practice" rather than "mastered" when the repertoire has no moves yet', () => {
		render(Train, {
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
		render(Train, {
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
});
