// mychess/src/routes/(coach)/coach/players/[player_id]/player.test.ts
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import Page from './+page.svelte';

afterEach(cleanup);

// B22 + white resolves to the curated Alapin entry; C60 (Ruy Lopez) is not in
// the taxonomy, so it stands for a repertoire with no curated opening.
const ALAPIN = { id: 'rep-alapin', name: 'Alapin 2025', color: 'white', eco_code: 'B22', opening_id: null };
const OLD_ALAPIN = { id: 'rep-alapin-old', name: 'Alapin 2024', color: 'white', eco_code: 'B22', opening_id: null };
const UNCLASSIFIED = { id: 'rep-ruy', name: 'Ruy Lopez notes', color: 'white', eco_code: 'C60', opening_id: null };

function renderPage(assigned: unknown[], activeRepertoireIds: string[]) {
  render(Page, {
    props: {
      data: {
        player: { id: 'p1', display_name: 'Student' },
        stats: null,
        notes: [],
        coachReps: [],
        assignedReps: assigned.map((repertoire, i) => ({ id: `a${i}`, repertoire })),
        practiceReports: [],
        activeRepertoireIds,
        range: '30d',
        playerId: 'p1'
      },
      form: null
    }
  });
}

describe('the active-opening control', () => {
  it('marks the active repertoire and offers the other one', () => {
    renderPage([ALAPIN, OLD_ALAPIN], ['rep-alapin']);

    expect(screen.getByText('Active')).toBeTruthy();
    expect(screen.getAllByText('Make active')).toHaveLength(1);
  });

  it('shows the resolved opening name beside the repertoire', () => {
    renderPage([ALAPIN], ['rep-alapin']);

    expect(screen.getByText('Anti-Sicilian: Alapin')).toBeTruthy();
  });

  // Otherwise the coach gets a button whose action can only fail.
  it('offers nothing for a repertoire with no curated opening', () => {
    renderPage([UNCLASSIFIED], []);

    expect(screen.queryByText('Make active')).toBeNull();
    expect(screen.queryByText('Active')).toBeNull();
  });
});
