// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import Repertoires from './+page.svelte';
import { baseLocale, overwriteGetLocale } from '$lib/paraglide/runtime';

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

  // GitHub issue #158. `eco_name` is stored in English, so the Lithuanian name
  // has to come from `eco_code` at render time — this asserts the row's own
  // stored string is not what reaches the page under `lt`.
  // Assigned, not owned: the owned list renders `eco_code` alone (line 94),
  // so the assigned section is the only place on this page carrying a name.
  it('renders the opening name in Lithuanian under the lt locale', () => {
    const owned = [
      {
        id: 'r1',
        name: 'Najdorf',
        color: '#4f46e5',
        moves: [{ count: 12 }],
        eco_code: 'B90',
        eco_name: 'Sicilian Defense: Najdorf Variation'
      }
    ];

    render(Repertoires, { props: { data: { repertoires: [], assignedRepertoires: owned } } });
    expect(screen.getByText(/Sicilian Defense: Najdorf Variation/)).toBeTruthy();
    cleanup();

    overwriteGetLocale(() => 'lt');
    try {
      render(Repertoires, { props: { data: { repertoires: [], assignedRepertoires: owned } } });
      expect(screen.getByText(/Siciliška gynyba, Naidorfo variantas/)).toBeTruthy();
      expect(screen.queryByText(/Sicilian Defense: Najdorf Variation/)).toBeNull();
    } finally {
      overwriteGetLocale(() => baseLocale);
    }
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

  // GitHub issue #201. Resolution matches on 'white'/'black', not the CSS hex
  // this page's other fixtures use for `color`, so these use the real values.
  // The owned list renders `eco_code` alone (no name at all — see line 94), so
  // the cascade only shows up in the assigned section; these fixtures go under
  // `assignedRepertoires` accordingly, not `repertoires`.
  const prepRep = { id: 'r9', name: 'Alapin file', color: 'white', moves: [{ count: 5 }] };

  it('shows the resolved opening instead of the ECO name', () => {
    const alapinData = {
      repertoires: [],
      assignedRepertoires: [
        { ...prepRep, eco_code: 'B22', eco_name: 'Sicilian Defense: Alapin Variation', opening_id: null }
      ]
    };

    render(Repertoires, { props: { data: alapinData } });
    expect(screen.getByText(/Anti-Sicilian: Alapin/)).toBeTruthy();
    expect(screen.queryByText(/Sicilian Defense: Alapin Variation/)).toBeNull();
    cleanup();

    // The curated name has its own locale, distinct from the ECO name's own
    // `lt` translation — this pins the page's `getLocale()` wiring, not just
    // `curatedOpeningName`'s own switch (already covered in resolve.test.ts).
    overwriteGetLocale(() => 'lt');
    try {
      render(Repertoires, { props: { data: alapinData } });
      expect(screen.getByText(/Prieš siciliškąją: Alapino variantas/)).toBeTruthy();
      expect(screen.queryByText(/Anti-Sicilian: Alapin/)).toBeNull();
    } finally {
      overwriteGetLocale(() => baseLocale);
    }
  });

  it('falls back to the ECO line when no opening resolves', () => {
    render(Repertoires, {
      props: {
        data: {
          repertoires: [],
          assignedRepertoires: [{ ...prepRep, eco_code: 'A00', eco_name: 'Amar Opening', opening_id: null }]
        }
      }
    });
    expect(screen.getByText(/A00 — Amar Opening/)).toBeTruthy();
  });

  it('honours a stored override over the ECO code', () => {
    render(Repertoires, {
      props: {
        data: {
          repertoires: [],
          assignedRepertoires: [
            { ...prepRep, eco_code: 'B22', eco_name: 'Sicilian Defense: Alapin Variation', opening_id: 'open-sicilian-white' }
          ]
        }
      }
    });
    expect(screen.getByText(/Open Sicilian/)).toBeTruthy();
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
