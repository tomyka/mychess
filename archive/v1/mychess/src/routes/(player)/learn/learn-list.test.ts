// @vitest-environment jsdom
// mychess/src/routes/(player)/learn/learn-list.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import Learn from './+page.svelte';

afterEach(() => cleanup());

const unfinished = {
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

describe('learn list page', () => {
	it('lists a repertoire that still has material to learn', () => {
		render(Learn, { props: { data: { repertoires: [unfinished], learnedCount: 0 } } });
		expect(screen.getByText('French Defense')).toBeTruthy();
	});

	// A fully-learned repertoire is filtered out server-side; the list still has
	// to say where it went, or its disappearance reads as data loss.
	it('says where fully-learned repertoires went, alongside the ones left to learn', () => {
		render(Learn, { props: { data: { repertoires: [unfinished], learnedCount: 2 } } });
		expect(screen.getByText('French Defense')).toBeTruthy();
		expect(screen.getByText(/2 fully learned repertoires live in/i)).toBeTruthy();
	});

	it('shows "nothing left to learn" when every repertoire is finished', () => {
		render(Learn, { props: { data: { repertoires: [], learnedCount: 3 } } });
		expect(screen.getByText(/Nothing left to learn/i)).toBeTruthy();
		expect(screen.getByText(/All 3 of your repertoires are/i)).toBeTruthy();
		expect(screen.queryByText(/No repertoires yet/i)).toBeNull();
	});

	it('shows the plain "no repertoires yet" message when the player has none at all', () => {
		render(Learn, { props: { data: { repertoires: [], learnedCount: 0 } } });
		expect(screen.getByText(/No repertoires yet/i)).toBeTruthy();
		expect(screen.queryByText(/Nothing left to learn/i)).toBeNull();
	});
});
