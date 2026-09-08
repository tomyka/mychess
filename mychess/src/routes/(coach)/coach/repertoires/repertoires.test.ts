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
    eco_code: 'B90',
    eco_name: 'Sicilian Defense: Najdorf Variation',
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
    expect(screen.getByText(/Sicilian Defense: Najdorf Variation/)).toBeTruthy();
    cleanup();

    overwriteGetLocale(() => 'lt');
    try {
      renderPage();
      expect(screen.getByText(/Siciliška gynyba, Naidorfo variantas/)).toBeTruthy();
      expect(screen.queryByText(/Sicilian Defense: Najdorf Variation/)).toBeNull();
    } finally {
      overwriteGetLocale(() => baseLocale);
    }
  });

  it('keeps showing the ECO code alongside the name', () => {
    renderPage();
    expect(screen.getByText('B90')).toBeTruthy();
  });
});
