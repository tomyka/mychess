// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import Reports from './+page.svelte';

afterEach(() => cleanup());

describe('coach practice reports overview', () => {
  it('shows an empty state with no students', () => {
    render(Reports, { props: { data: { students: [] } } });
    expect(screen.getByText('No students yet')).toBeTruthy();
  });

  it('lists each student with their accuracy, session count, average level, and last-practiced date', () => {
    render(Reports, {
      props: {
        data: {
          students: [
            {
              player: { id: 'p1', display_name: 'Paulius Konovalovas' },
              summary: { accuracyPct: 82, sessionCount: 5, lastPracticedAt: '2026-08-10T10:00:00Z', avgLevel: 2.5 }
            }
          ]
        }
      }
    });
    expect(screen.getByText('Paulius Konovalovas')).toBeTruthy();
    expect(screen.getByText('82%')).toBeTruthy();
    expect(screen.getByText('5')).toBeTruthy();
    expect(screen.getByText('2.5')).toBeTruthy();
    expect(document.querySelector('a[href="/coach/players/p1"]')).toBeTruthy();
  });

  it('shows a dash for a student with no attempts logged yet', () => {
    render(Reports, {
      props: {
        data: {
          students: [
            {
              player: { id: 'p1', display_name: 'New Student' },
              summary: { accuracyPct: null, sessionCount: 0, lastPracticedAt: null, avgLevel: null }
            }
          ]
        }
      }
    });
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});
