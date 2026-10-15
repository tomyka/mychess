// mychess/src/routes/(player)/practice/[repertoire_id]/mastery/mastery.test.ts
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import Page from './+page.svelte';

afterEach(cleanup);

function renderWith(data: Record<string, unknown>) {
	render(Page, {
		props: {
			data: {
				repertoire: { id: 'r1', name: 'Italian Game', color: 'white' },
				chapters: [],
				repertoireLevel: null,
				...data
			}
		}
	});
}

describe('knowledge levels page', () => {
	it('shows the empty state when there are no chapters', () => {
		renderWith({});
		expect(screen.getByText(/Learn some lines first/)).toBeTruthy();
	});

	it('lists each chapter with its level badge', () => {
		renderWith({
			chapters: [
				{ chapter: 'Main Line', total: 5, learned: 5, level: 'silver' },
				{ chapter: 'Sideline', total: 3, learned: 1, level: null }
			],
			repertoireLevel: null
		});
		expect(screen.getByText('Main Line')).toBeTruthy();
		expect(screen.getByText('Sideline')).toBeTruthy();
		expect(screen.getByText('Silver')).toBeTruthy();
		// The repertoire summary badge also reads "Unranked" here (repertoireLevel
		// is null), alongside the Sideline chapter's own badge — assert presence
		// rather than uniqueness, as with "Platinum" below.
		expect(screen.getAllByText('Unranked').length).toBeGreaterThan(0);
		expect(screen.getByText('5/5 learned')).toBeTruthy();
		expect(screen.getByText('1/3 learned')).toBeTruthy();
	});

	it('shows the repertoire-wide level when there is at least one chapter', () => {
		renderWith({
			chapters: [{ chapter: 'Main Line', total: 5, learned: 5, level: 'platinum' }],
			repertoireLevel: 'platinum'
		});
		expect(screen.getByText('Overall level:')).toBeTruthy();
		// Both the repertoire summary badge and the chapter's own badge read
		// "Platinum" here (the lone chapter and the repertoire are both at that
		// tier) — assert presence rather than uniqueness.
		expect(screen.getAllByText('Platinum').length).toBeGreaterThan(0);
	});
});
