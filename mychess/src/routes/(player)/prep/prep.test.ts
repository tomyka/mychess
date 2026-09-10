// mychess/src/routes/(player)/prep/prep.test.ts
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import Page from './+page.svelte';
import { overwriteGetLocale, baseLocale } from '$lib/paraglide/runtime';

afterEach(() => {
	cleanup();
	overwriteGetLocale(() => baseLocale);
});

const ALAPIN = {
	opening: {
		id: 'anti-sicilian-alapin-white',
		name: 'Anti-Sicilian: Alapin',
		nameLt: 'Prieš siciliškąją: Alapino variantas',
		side: 'white',
		ecoCodes: ['B22']
	},
	repertoire: { id: 'rep-1', name: 'Alapin 2025', color: 'white', eco_code: 'B22', opening_id: null }
};

const NAJDORF = {
	opening: {
		id: 'sicilian-najdorf-black',
		name: 'Sicilian: Najdorf',
		nameLt: 'Siciliška: Naidorfo variantas',
		side: 'black',
		ecoCodes: ['B90']
	},
	repertoire: { id: 'rep-2', name: 'Najdorf notes', color: 'black', eco_code: 'B90', opening_id: null }
};

describe('the prep view', () => {
	it('leads with the opening, not the filename', () => {
		render(Page, { props: { data: { preparation: [ALAPIN] } } });

		const opening = screen.getByRole('heading', { name: 'Anti-Sicilian: Alapin' });
		expect(opening).toBeTruthy();
		// The filename is still shown — it is how a coach refers to the file —
		// but it is not the heading, which is the whole point of this view.
		expect(screen.getByText('Alapin 2025').tagName).not.toBe('H3');
	});

	it('separates what you play as White from as Black', () => {
		render(Page, { props: { data: { preparation: [ALAPIN, NAJDORF] } } });

		expect(screen.getByRole('heading', { name: 'As White' })).toBeTruthy();
		expect(screen.getByRole('heading', { name: 'As Black' })).toBeTruthy();
	});

	it('omits a side heading when nothing is prepared for it', () => {
		render(Page, { props: { data: { preparation: [ALAPIN] } } });

		expect(screen.queryByRole('heading', { name: 'As Black' })).toBeNull();
	});

	it('says so plainly when nothing is set as current preparation', () => {
		render(Page, { props: { data: { preparation: [] } } });

		expect(screen.getByText(/Nothing is set as your current preparation/)).toBeTruthy();
	});

	// The link must reach a read-only surface: this view records no progress,
	// which is epic #119's standing non-goal, so it must not route into Learn.
	it('links to the read-only line breakdown, not to Learn', () => {
		render(Page, { props: { data: { preparation: [ALAPIN] } } });

		const link = screen.getByRole('link', { name: 'View lines' });
		expect(link.getAttribute('href')).toBe('/practice/rep-1/mastery');
	});

	it('renders the opening name in the active locale', () => {
		overwriteGetLocale(() => 'lt');
		render(Page, { props: { data: { preparation: [ALAPIN] } } });

		expect(screen.getByRole('heading', { name: 'Prieš siciliškąją: Alapino variantas' })).toBeTruthy();
	});
});
