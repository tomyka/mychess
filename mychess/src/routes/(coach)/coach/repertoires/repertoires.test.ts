// mychess/src/routes/(coach)/coach/repertoires/repertoires.test.ts
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import Page from './+page.svelte';
import { baseLocale, overwriteGetLocale } from '$lib/paraglide/runtime';

afterEach(cleanup);

const REPERTOIRES = [
  {
    id: 'r1',
    name: 'Najdorf',
    color: 'white',
    moves: [{ count: 12 }],
    // GitHub issue #201: this used to be B90, but B90-B99 + white now
    // legitimately resolves to the curated "Open Sicilian" entry, which would
    // hijack these two ECO-name/locale-focused tests. C60 (Ruy Lopez) isn't
    // in the taxonomy, so it still falls through to the plain ECO line.
    eco_code: 'C60',
    eco_name: 'Ruy Lopez',
    // The page reads this unguarded, so it is required, not decoration.
    assignedPlayers: []
  }
];

function renderPage() {
  render(Page, { props: { data: { repertoires: REPERTOIRES, players: [] }, form: null } });
}

describe('coach repertoires page', () => {
  // GitHub issue #158. `eco_name` holds the English name detected at import,
  // so the Lithuanian one has to be derived from `eco_code` at render time.
  it('renders the opening name in Lithuanian under the lt locale', () => {
    renderPage();
    expect(screen.getByText(/Ruy Lopez/)).toBeTruthy();
    cleanup();

    overwriteGetLocale(() => 'lt');
    try {
      renderPage();
      expect(screen.getByText(/Ispaniška partija/)).toBeTruthy();
      expect(screen.queryByText(/Ruy Lopez/)).toBeNull();
    } finally {
      overwriteGetLocale(() => baseLocale);
    }
  });

  it('keeps showing the ECO code alongside the name', () => {
    renderPage();
    expect(screen.getByText('C60')).toBeTruthy();
  });

  // GitHub issue #201. B22 + white resolves to the Alapin entry, so the prep
  // name replaces the ECO line rather than sitting beside it.
  it('shows the resolved opening instead of the ECO name', () => {
    const alapinRep = {
      repertoires: [
        { ...REPERTOIRES[0], eco_code: 'B22', eco_name: 'Sicilian Defense: Alapin Variation', opening_id: null }
      ],
      players: []
    };

    render(Page, { props: { data: alapinRep, form: null } });
    expect(screen.getByText(/Anti-Sicilian: Alapin/)).toBeTruthy();
    expect(screen.queryByText(/Sicilian Defense: Alapin Variation/)).toBeNull();
    cleanup();

    // The curated name has its own locale, distinct from the ECO name's own
    // `lt` translation — this pins the page's `getLocale()` wiring, not just
    // `curatedOpeningName`'s own switch (already covered in resolve.test.ts).
    overwriteGetLocale(() => 'lt');
    try {
      render(Page, { props: { data: alapinRep, form: null } });
      expect(screen.getByText(/Prieš siciliškąją: Alapino variantas/)).toBeTruthy();
      expect(screen.queryByText(/Anti-Sicilian: Alapin/)).toBeNull();
    } finally {
      overwriteGetLocale(() => baseLocale);
    }
  });

  it('falls back to the ECO line when no opening resolves', () => {
    render(Page, {
      props: {
        data: {
          repertoires: [{ ...REPERTOIRES[0], eco_code: 'A00', eco_name: 'Amar Opening', opening_id: null }],
          players: []
        },
        form: null
      }
    });
    expect(screen.getByText(/Amar Opening/)).toBeTruthy();
    expect(screen.getByText('A00')).toBeTruthy();
  });

  it('honours a stored override over the ECO code', () => {
    render(Page, {
      props: {
        data: {
          repertoires: [
            { ...REPERTOIRES[0], eco_code: 'B22', eco_name: 'Sicilian Defense: Alapin Variation', opening_id: 'open-sicilian-white' }
          ],
          players: []
        },
        form: null
      }
    });
    expect(screen.getByText(/Open Sicilian/)).toBeTruthy();
  });
});
