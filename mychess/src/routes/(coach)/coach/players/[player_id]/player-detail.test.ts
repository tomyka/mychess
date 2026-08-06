// mychess/src/routes/(coach)/coach/players/[player_id]/player-detail.test.ts
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';
import PlayerDetail from './+page.svelte';

afterEach(() => cleanup());

const baseData = {
  player: { id: 'p1', display_name: 'Paulius Konovalovas' },
  stats: { total_reviews: 40, moves_learned: 12 },
  notes: [],
  coachReps: [],
  assignedReps: [],
  playerId: 'p1'
};

describe('coach student detail page', () => {
  it('shows the student name and stats', () => {
    render(PlayerDetail, { props: { data: baseData, form: null } });
    expect(screen.getByText('Paulius Konovalovas')).toBeTruthy();
    expect(screen.getByText('40')).toBeTruthy();
  });

  it('shows a link to Upload PGN when the coach has no repertoires yet', () => {
    render(PlayerDetail, { props: { data: baseData, form: null } });
    expect(screen.getByRole('link', { name: 'Upload one' })).toBeTruthy();
  });

  it('shows the assign-repertoires button when the coach has repertoires', () => {
    render(PlayerDetail, {
      props: {
        data: { ...baseData, coachReps: [{ id: 'r1', name: 'Sicilian Defense', color: 'white' }] },
        form: null
      }
    });
    expect(screen.getByRole('button', { name: 'Assign repertoires' })).toBeTruthy();
  });

  it('opens a modal listing repertoires with an Assign button when + is clicked', async () => {
    render(PlayerDetail, {
      props: {
        data: { ...baseData, coachReps: [{ id: 'r1', name: 'Sicilian Defense', color: 'white' }] },
        form: null
      }
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Assign repertoires' }));
    expect(screen.getByText('Sicilian Defense')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Assign' })).toBeTruthy();
  });

  it('shows a Remove button in the modal for already-assigned repertoires', async () => {
    render(PlayerDetail, {
      props: {
        data: {
          ...baseData,
          coachReps: [{ id: 'r1', name: 'Sicilian Defense', color: 'white' }],
          assignedReps: [{ id: 'a1', repertoire: { id: 'r1', name: 'Sicilian Defense', color: 'white' } }]
        },
        form: null
      }
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Assign repertoires' }));
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy();
  });

  it('shows already-assigned repertoires', () => {
    render(PlayerDetail, {
      props: {
        data: {
          ...baseData,
          assignedReps: [{ id: 'a1', repertoire: { id: 'r1', name: 'Sicilian Defense', color: 'white' } }]
        },
        form: null
      }
    });
    expect(screen.getByText('Sicilian Defense')).toBeTruthy();
  });

  it('shows existing notes', () => {
    render(PlayerDetail, {
      props: {
        data: { ...baseData, notes: [{ id: 'n1', note: 'Great progress this week!', created_at: '2026-01-01' }] },
        form: null
      }
    });
    expect(screen.getByText('Great progress this week!')).toBeTruthy();
  });

  it('shows a form error message when present', () => {
    render(PlayerDetail, { props: { data: baseData, form: { error: 'Note cannot be empty' } } });
    expect(screen.getByText('Note cannot be empty')).toBeTruthy();
  });
});
