import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../../../../i18n/locales';
import type { GroupGrid } from '../../../../server/coach-pages';
import { ProgressGrid } from './progress-grid';

const p = MESSAGES.lt.coach.progress;

const NONE = { overdue: false, paused: false, forked: false, updated: false };

const GRID: GroupGrid = {
  columns: [
    { id: 'r-1', name: 'Karo-Kan gynyba', side: 'black' },
    { id: 'r-2', name: 'Italų partija', side: 'white' },
  ],
  rows: [
    {
      player: { id: 'p-1', displayName: 'Gabija' },
      lastTrainedDays: 0,
      cells: [
        {
          badges: NONE,
          view: {
            kind: 'granted',
            standing: {
              counts: { notStarted: 1, skipped: 0, due: 5, learned: 2 },
              mastered: false,
            },
          },
        },
        null,
      ],
    },
    {
      player: { id: 'p-2', displayName: 'Rokas' },
      lastTrainedDays: null,
      cells: [
        { badges: { ...NONE, forked: true }, view: { kind: 'forked' } },
        {
          badges: { ...NONE, overdue: true },
          view: {
            kind: 'granted',
            standing: {
              counts: { notStarted: 0, skipped: 1, due: 0, learned: 3 },
              mastered: true,
            },
          },
        },
      ],
    },
  ],
};

function show(grid: GroupGrid = GRID, locale: 'lt' | 'en' = 'lt'): void {
  render(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>
      <ProgressGrid grid={grid} />
    </NextIntlClientProvider>,
  );
}

const rowOf = (name: RegExp) =>
  screen.getByRole('rowheader', { name }).closest('tr');

describe('the group grid (R-153)', () => {
  it('is a titled table: a column per repertoire, a row per player', () => {
    show();
    const section = screen.getByRole('region', { name: p.gridTitle });
    const table = within(section).getByRole('table');
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((header) => header.textContent);
    expect(headers).toEqual([p.player, 'Karo-Kan gynyba', 'Italų partija']);
    expect(within(table).getAllByRole('rowheader')).toHaveLength(2);
  });

  it('names each player with a link to their page and when they last trained', () => {
    show();
    const gabija = screen.getByRole('rowheader', { name: /Gabija/ });
    expect(
      within(gabija).getByRole('link', { name: 'Gabija' }).getAttribute('href'),
    ).toBe('/treneris/zaidejai/p-1');
    expect(within(gabija).getByText(p.today)).toBeTruthy();
    const rokas = screen.getByRole('rowheader', { name: /Rokas/ });
    expect(within(rokas).getByText(p.neverTrained)).toBeTruthy();
  });

  it('shows % learned and due in a cell that opens the player’s progress', () => {
    show();
    const cell = screen.getByRole('link', { name: /88 %/ });
    expect(cell.getAttribute('href')).toBe(
      '/treneris/zaidejai/p-1/pazanga/r-1',
    );
    expect(within(cell).getByText('5 kartotini')).toBeTruthy();
    expect(within(cell).getByText('88 % išmokta')).toBeTruthy();
  });

  it('names the player and the repertoire in each cell link, around its visible text', () => {
    show();
    expect(
      screen
        .getAllByRole('link', { name: /išmokta/ })
        .map((link) => link.getAttribute('aria-label')),
    ).toEqual([
      'Gabija, Karo-Kan gynyba: 88 % išmokta, 5 kartotini',
      'Rokas, Italų partija: 100 % išmokta, 0 kartotinų',
    ]);
  });

  it('draws Mastered as the state bar’s pill', () => {
    show();
    expect(screen.getByText(p.mastered).className).toContain('rounded-pill');
  });

  it('says where a player has no assignment of a repertoire', () => {
    show();
    const gabija = rowOf(/Gabija/);
    expect(gabija).not.toBeNull();
    const cells = gabija === null ? [] : within(gabija).getAllByRole('cell');
    expect(cells[1]?.textContent).toBe(p.noAssignment);
  });

  it('shows a forked cell with its badge only, and no way into its progress', () => {
    show();
    const rokas = rowOf(/Rokas/);
    const cells = rokas === null ? [] : within(rokas).getAllByRole('cell');
    const forked = cells[0];
    expect(forked?.textContent).toBe('Pasidarė asmeninę kopiją');
    expect(forked?.querySelector('a')).toBeNull();
  });

  it('shows the badges and Mastered beside a cell’s progress', () => {
    show();
    const rokas = rowOf(/Rokas/);
    const cells = rokas === null ? [] : within(rokas).getAllByRole('cell');
    const cell = cells[1];
    expect(cell).toBeDefined();
    if (cell === undefined) return;
    expect(
      within(cell).getByRole('link', { name: /100 %/ }).getAttribute('href'),
    ).toBe('/treneris/zaidejai/p-2/pazanga/r-2');
    expect(within(cell).getByText('0 kartotinų')).toBeTruthy();
    expect(within(cell).getByText('Pradelsta')).toBeTruthy();
    expect(within(cell).getByText(p.mastered)).toBeTruthy();
  });

  it('says there is nothing to learn when a repertoire has no own move', () => {
    show({
      columns: [{ id: 'r-1', name: 'Tuščias', side: 'white' }],
      rows: [
        {
          player: { id: 'p-1', displayName: 'Gabija' },
          lastTrainedDays: 3,
          cells: [
            {
              badges: NONE,
              view: {
                kind: 'granted',
                standing: {
                  counts: { notStarted: 0, skipped: 0, due: 0, learned: 0 },
                  mastered: false,
                },
              },
            },
          ],
        },
      ],
    });
    const cell = screen.getByRole('link', { name: new RegExp(p.nothing) });
    expect(cell.textContent).toBe(p.nothing);
    expect(cell.getAttribute('aria-label')).toBe(
      `Gabija, Tuščias: ${p.nothing}`,
    );
  });

  it('says so when nothing is assigned to the group', () => {
    show({ columns: [], rows: [] });
    expect(screen.getByText(p.gridEmpty)).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('scrolls only the table sideways, with the player column fixed', () => {
    show();
    const table = screen.getByRole('table');
    expect(table.parentElement?.className).toContain('overflow-x-auto');
    const header = screen.getByRole('rowheader', { name: /Gabija/ });
    expect(header.className).toContain('sticky');
  });

  it('speaks English on the English page', () => {
    show(GRID, 'en');
    const e = MESSAGES.en.coach.progress;
    expect(screen.getByRole('region', { name: e.gridTitle })).toBeTruthy();
    expect(screen.getByRole('link', { name: /88% learned/ })).toBeTruthy();
    expect(screen.getByText('5 due')).toBeTruthy();
    expect(
      screen.getByRole('link', {
        name: 'Gabija, Karo-Kan gynyba: 88% learned, 5 due',
      }),
    ).toBeTruthy();
  });
});
