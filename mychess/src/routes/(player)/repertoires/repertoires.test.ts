// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import Repertoires from './+page.svelte';

afterEach(() => cleanup());

const assigned = [{ id: 'r1', name: 'French Defense', color: '#4f46e5', moves: [{ count: 12 }] }];

describe('repertoires page', () => {
  it('shows the assigned-by-coach section when there are assignments', () => {
    render(Repertoires, { props: { data: { repertoires: [], assignedRepertoires: assigned } } });
    expect(screen.getByText(/Assigned by your coach/i)).toBeTruthy();
    expect(screen.getByText('French Defense')).toBeTruthy();
  });
  it('hides the assigned section when there are none', () => {
    render(Repertoires, { props: { data: { repertoires: [], assignedRepertoires: [] } } });
    expect(screen.queryByText(/Assigned by your coach/i)).toBeNull();
  });
  it('suggests asking a coach only when nothing is assigned either', () => {
    render(Repertoires, { props: { data: { repertoires: [], assignedRepertoires: [] } } });
    expect(screen.getByText(/Ask your coach to assign one/i)).toBeTruthy();
  });
  it('does not suggest asking a coach when repertoires are already assigned', () => {
    render(Repertoires, { props: { data: { repertoires: [], assignedRepertoires: assigned } } });
    expect(screen.queryByText(/Ask your coach to assign one/i)).toBeNull();
  });

  it('shows a delete form with the repertoire id for each owned repertoire', () => {
    const owned = [{ id: 'r1', name: 'French Defense', color: '#4f46e5', moves: [{ count: 12 }] }];
    render(Repertoires, { props: { data: { repertoires: owned, assignedRepertoires: [] } } });
    const form = document.querySelector('form[action="?/delete"]') as HTMLFormElement;
    expect(form).toBeTruthy();
    expect((form.querySelector('input[name="rep_id"]') as HTMLInputElement).value).toBe('r1');
    expect(screen.getByRole('button', { name: /delete/i })).toBeTruthy();
  });

  it('links an owned repertoire to its learn page, not a nonexistent /repertoires/[id] route', () => {
    const owned = [{ id: 'r1', name: 'French Defense', color: '#4f46e5', moves: [{ count: 12 }] }];
    render(Repertoires, { props: { data: { repertoires: owned, assignedRepertoires: [] } } });
    const link = screen.getByText('French Defense').closest('a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/learn/r1');
    expect(screen.getByText(/Learn →/)).toBeTruthy();
  });

  it('shows a Practice link instead of Learn once an owned repertoire is fully learned', () => {
    const owned = [{ id: 'r1', name: 'French Defense', color: '#4f46e5', moves: [{ count: 12 }], allSolved: true }];
    render(Repertoires, { props: { data: { repertoires: owned, assignedRepertoires: [] } } });
    const link = screen.getByText('French Defense').closest('a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/practice/r1');
    expect(screen.getByText(/Practice →/)).toBeTruthy();
  });

  it('shows Learn for an outstanding assigned repertoire and Practice once it is fully learned', () => {
    const outstanding = [{ id: 'r1', name: 'French Defense', color: '#4f46e5', moves: [{ count: 12 }], allSolved: false }];
    const learned = render(Repertoires, { props: { data: { repertoires: [], assignedRepertoires: outstanding } } });
    expect(learned.getByRole('link', { name: 'Learn' }).getAttribute('href')).toBe('/learn/r1');
    learned.unmount();

    const done = [{ id: 'r1', name: 'French Defense', color: '#4f46e5', moves: [{ count: 12 }], allSolved: true }];
    render(Repertoires, { props: { data: { repertoires: [], assignedRepertoires: done } } });
    expect(screen.getByRole('link', { name: 'Practice' }).getAttribute('href')).toBe('/practice/r1');
  });

  it('does not show a delete form in the assigned-by-coach section', () => {
    render(Repertoires, { props: { data: { repertoires: [], assignedRepertoires: assigned } } });
    expect(document.querySelector('form[action="?/delete"]')).toBeNull();
  });
});

describe('RepertoirePracticeRow destination', () => {
	// Regression: #96 moved the teaching flow to /learn and repointed this row's
	// hardcoded href, which silently sent the Practice list's visitors into Learn.
	// The destination is a prop now, and both callers pass their own.
	it('links to the mode it was given', async () => {
		const { default: Row } = await import('$lib/components/RepertoirePracticeRow.svelte');
		const rep = {
			id: 'r1',
			name: 'French Defense',
			color: 'white',
			solved: 1,
			total: 3,
			allSolved: false,
			fullVariationCount: 3,
			excludedVariationCount: 0,
			hasChapters: false,
			status: 'learning' as const
		};

		const learn = render(Row, { props: { rep, mode: 'learn' } });
		expect(learn.getByText('French Defense').closest('a')?.getAttribute('href')).toBe('/learn/r1');
		learn.unmount();

		const practice = render(Row, { props: { rep, mode: 'practice' } });
		expect(practice.getByText('French Defense').closest('a')?.getAttribute('href')).toBe('/practice/r1');
	});
});
