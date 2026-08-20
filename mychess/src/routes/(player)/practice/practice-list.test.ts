// @vitest-environment jsdom
// mychess/src/routes/(player)/practice/practice-list.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import Practice from './+page.svelte';

afterEach(() => cleanup());

const rep = {
	id: 'r1',
	name: 'French Defense',
	color: 'white',
	solved: 2,
	total: 3,
	allSolved: false,
	fullVariationCount: 3,
	excludedVariationCount: 0,
	hasChapters: true
};

describe('practice list page', () => {
	it('lists a repertoire that has at least one fully-learned chapter', () => {
		render(Practice, { props: { data: { repertoires: [rep], hasAnyRepertoires: true } } });
		expect(screen.getByText('French Defense')).toBeTruthy();
	});

	it('shows "nothing ready to practice yet" when repertoires exist but none are practice-ready', () => {
		render(Practice, { props: { data: { repertoires: [], hasAnyRepertoires: true } } });
		expect(screen.getByText(/Nothing ready to practice yet/i)).toBeTruthy();
		expect(screen.queryByText(/No repertoires yet/i)).toBeNull();
		expect(screen.queryByText(/Ask your coach/i)).toBeNull();
	});

	it('shows the plain "no repertoires yet" message when the player has none at all', () => {
		render(Practice, { props: { data: { repertoires: [], hasAnyRepertoires: false } } });
		expect(screen.getByText(/No repertoires yet/i)).toBeTruthy();
		expect(screen.getByText(/Ask your coach/i)).toBeTruthy();
		expect(screen.queryByText(/Nothing ready to practice yet/i)).toBeNull();
	});
});
