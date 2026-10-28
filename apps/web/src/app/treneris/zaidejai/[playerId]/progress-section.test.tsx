import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../../../../i18n/locales';
import type { PlayerProgressSection } from '../../../../server/coach-progress';
import { ProgressSection } from './progress-section';

const p = MESSAGES.lt.coach.progress;
const COUNTS = { notStarted: 2, skipped: 0, due: 1, learned: 1 };

const PROGRESS: PlayerProgressSection = {
  lastTrainedDays: 4,
  rows: [
    {
      repertoire: { id: 'r-1', name: 'Karo-Kan gynyba', side: 'black' },
      source: 'assigned',
      badges: { overdue: true, paused: false, forked: false, updated: false },
      view: { kind: 'granted', standing: { counts: COUNTS, mastered: false } },
    },
    {
      repertoire: { id: 'r-2', name: 'Itališkoji partija', side: 'white' },
      source: 'assigned',
      badges: { overdue: false, paused: false, forked: true, updated: false },
      view: { kind: 'forked' },
    },
    {
      repertoire: { id: 'r-3', name: 'Londono sistema', side: 'white' },
      source: 'shared',
      badges: null,
      view: {
        kind: 'granted',
        standing: {
          counts: { notStarted: 0, skipped: 0, due: 0, learned: 3 },
          mastered: true,
        },
      },
    },
  ],
};

function show(progress: PlayerProgressSection = PROGRESS): void {
  render(
    <NextIntlClientProvider locale="lt" messages={MESSAGES.lt}>
      <ProgressSection
        player={{ id: 'p-1', displayName: 'Rokas' }}
        progress={progress}
      />
    </NextIntlClientProvider>,
  );
}

/** The progress row an element is in. */
const rowOf = (element: HTMLElement): HTMLElement => {
  const row = element.closest('li');
  if (row === null) throw new Error('no row');
  return row;
};

describe('the player page’s progress section (R-151, R-154, R-155)', () => {
  it('is a region titled Progress', () => {
    show();
    expect(
      screen.getByRole('region', { name: p.title }).querySelector('h2')
        ?.textContent,
    ).toBe(p.title);
  });

  it('links each visible repertoire to its progress page with % and badges', () => {
    show();
    const link = screen.getByRole('link', { name: 'Karo-Kan gynyba' });
    expect(link.getAttribute('href')).toBe(
      '/treneris/zaidejai/p-1/pazanga/r-1',
    );
    const row = within(rowOf(link));
    expect(row.getByText('Pradelsta')).toBeTruthy();
    expect(row.getByText('Priskirtas · 50 % išmokta')).toBeTruthy();
    expect(row.getByText(/1 išmokta · 1 kartotinas/)).toBeTruthy();
  });

  it('shows a shared repertoire with no badges, and Mastered', () => {
    show();
    const link = screen.getByRole('link', { name: 'Londono sistema' });
    expect(link.getAttribute('href')).toBe(
      '/treneris/zaidejai/p-1/pazanga/r-3',
    );
    const row = within(rowOf(link));
    expect(row.getByText('Bendrinamas · 100 % išmokta')).toBeTruthy();
    expect(row.getByText(p.mastered)).toBeTruthy();
    expect(row.queryByText('Pradelsta')).toBeNull();
  });

  it('says once that there is nothing to learn in a repertoire with no own move', () => {
    show({
      lastTrainedDays: 1,
      rows: [
        {
          repertoire: { id: 'r-4', name: 'Tuščias', side: 'white' },
          source: 'assigned',
          badges: null,
          view: {
            kind: 'granted',
            standing: {
              counts: { notStarted: 0, skipped: 0, due: 0, learned: 0 },
              mastered: false,
            },
          },
        },
      ],
    });
    const row = within(rowOf(screen.getByRole('link', { name: 'Tuščias' })));
    expect(row.getByText(p.assigned).textContent).toBe(p.assigned);
    expect(row.getAllByText(new RegExp(p.nothing))).toHaveLength(1);
  });

  it('shows a forked assignment with its badge, no link and no numbers', () => {
    show();
    expect(
      screen.queryByRole('link', { name: /Itališkoji partija/ }),
    ).toBeNull();
    const row = within(rowOf(screen.getByText('Itališkoji partija')));
    expect(row.getByText(MESSAGES.lt.assignment.badge.forked)).toBeTruthy();
    expect(row.getByText(p.forkedNote)).toBeTruthy();
    expect(row.getByText(p.assigned)).toBeTruthy();
    expect(row.queryByText(/išmokta/)).toBeNull();
  });

  it('says when the player last trained', () => {
    show();
    expect(
      screen.getByText('Paskutinį kartą treniravosi prieš 4 dienas'),
    ).toBeTruthy();
  });

  it('says when the coach can see no repertoire of the player', () => {
    show({ rows: [], lastTrainedDays: null });
    expect(
      screen.getByText('Rokas dar neturi jums matomų repertuarų.'),
    ).toBeTruthy();
    expect(screen.getByText(p.neverTrained)).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
  });
});
