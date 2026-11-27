import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../../../../i18n/catalogue';
import type { GroupGrid } from '../../../../server/coach-pages';
import { ProgressGrid } from './progress-grid';

const p = MESSAGES.coach.progress;
const badge = MESSAGES.assignment.badge;

const STATUS = {
  deadline: null,
  overdue: false,
  paused: false,
  done: false,
  forked: false,
};

const granted = (
  counts: { notStarted: number; skipped: number; due: number; learned: number },
  mastered = false,
) => ({ kind: 'granted', standing: { counts, mastered } }) as const;

const column = (id: string, name: string) =>
  ({ id, name, side: 'white', deadline: null, done: 0, count: 0 }) as const;

const GRID: GroupGrid = {
  columns: [column('r-1', 'Karo-Kan gynyba'), column('r-2', 'Italų partija')],
  rows: [
    {
      player: { id: 'p-1', displayName: 'Gabija' },
      lastTrainedDays: 0,
      cells: [
        {
          status: STATUS,
          view: granted({ notStarted: 1, skipped: 0, due: 5, learned: 2 }),
        },
        null,
      ],
    },
    {
      player: { id: 'p-2', displayName: 'Rokas' },
      lastTrainedDays: null,
      cells: [
        {
          status: { ...STATUS, forked: true },
          view: { kind: 'forked', sharedForkId: null },
        },
        {
          status: { ...STATUS, done: true },
          view: granted(
            { notStarted: 0, skipped: 0, due: 0, learned: 4 },
            true,
          ),
        },
      ],
    },
    {
      player: { id: 'p-3', displayName: 'Dovydas' },
      lastTrainedDays: 5,
      cells: [
        {
          status: STATUS,
          view: granted({ notStarted: 7, skipped: 0, due: 0, learned: 0 }),
        },
        {
          status: { ...STATUS, overdue: true, paused: true },
          view: granted({ notStarted: 1, skipped: 0, due: 2, learned: 1 }),
        },
      ],
    },
  ],
};

function show(grid: GroupGrid = GRID): void {
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      <ProgressGrid grid={grid} />
    </NextIntlClientProvider>,
  );
}

const section = () => within(screen.getByRole('region', { name: p.gridTitle }));
/** The desktop grid. */
const table = () => within(section().getByRole('table'));
/** The phone list: one card per member. */
const cards = () => section().getByRole('list', { name: p.gridTitle });
const cardOf = (name: string) =>
  within(
    within(cards())
      .getAllByRole('listitem')
      .find((item) => item.querySelector('a')?.textContent === name) ??
      document.body,
  );
const rowOf = (name: string) =>
  within(
    table()
      .getByRole('rowheader', { name: new RegExp(name) })
      .closest('tr') ?? document.body,
  );
/** A member's cell link of `repertoire` in the desktop grid. */
const cellOf = (name: string, repertoire: RegExp) =>
  rowOf(name).getByRole('link', { name: repertoire });

describe('the group’s progress (R-153, spec A group)', () => {
  it('is the Progress section', () => {
    show();
    expect(
      screen.getByRole('heading', { level: 2, name: p.gridTitle }),
    ).toBeDefined();
  });

  it('on a phone, gives each member a card with their name, last trained and a line per repertoire', () => {
    show();
    const gabija = cardOf('Gabija');
    expect(
      gabija.getByRole('link', { name: 'Gabija' }).getAttribute('href'),
    ).toBe('/coach/players/p-1');
    expect(gabija.getByText(p.trained.today)).toBeDefined();
    expect(gabija.getByText('Karo-Kan gynyba')).toBeDefined();
    expect(gabija.getByText('Italų partija')).toBeDefined();
    const line = gabija.getByRole('link', { name: /Karo-Kan gynyba/ });
    expect(line.getAttribute('href')).toBe('/coach/players/p-1/progress/r-1');
    expect(within(line).getByText('25% learned')).toBeDefined();
    expect(within(line).getByText('5 due').className).toContain('text-due');
    expect(cardOf('Rokas').getByText(p.trained.never)).toBeDefined();
  });

  it('on desktop, is a table: Player, a column per repertoire, Last trained last', () => {
    show();
    expect(
      table()
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual([
      p.player,
      'Karo-Kan gynyba',
      'Italų partija',
      MESSAGES.coach.players.column.lastTrained,
    ]);
    const gabija = rowOf('Gabija');
    expect(
      gabija.getByRole('link', { name: 'Gabija' }).getAttribute('href'),
    ).toBe('/coach/players/p-1');
    expect(gabija.getAllByRole('cell').at(-1)?.textContent).toBe(
      p.trained.today,
    );
  });

  it('links each cell to the member’s progress, named by player and repertoire (WCAG 2.5.3)', () => {
    show();
    const cell = cellOf('Gabija', /Karo-Kan/);
    expect(cell.getAttribute('href')).toBe('/coach/players/p-1/progress/r-1');
    expect(cell.getAttribute('aria-label')).toBe(
      'Gabija, Karo-Kan gynyba: 25% learned, 5 due',
    );
  });

  it('shows Done in place of % and due, with Mastered beside it', () => {
    show();
    const done = cellOf('Rokas', /Italų/);
    expect(done.textContent).toBe(MESSAGES.coach.status.done);
    expect(done.getAttribute('aria-label')).toBe(
      `Rokas, Italų partija: ${MESSAGES.coach.status.done}`,
    );
    expect(rowOf('Rokas').getByText(p.mastered)).toBeDefined();
  });

  it('shows one status pill in place of % and due, Overdue before Paused', () => {
    show();
    const late = cellOf('Dovydas', /Italų/);
    expect(late.textContent).toBe(badge.overdue);
    expect(within(late).queryByText(badge.paused)).toBeNull();
    expect(within(late).queryByText('2 due')).toBeNull();
    expect(within(late).queryByText('25% learned')).toBeNull();
  });

  it('shows Not started as a neutral pill for a repertoire not begun', () => {
    show();
    const fresh = cellOf('Dovydas', /Karo-Kan/);
    const pill = within(fresh).getByText(p.cellNotStarted);
    expect(pill.className).toContain('rounded-pill');
    expect(fresh.getAttribute('aria-label')).toBe(
      `Dovydas, Karo-Kan gynyba: ${p.cellNotStarted}`,
    );
  });

  it('shows a forked cell with its badge only, and no way into its progress', () => {
    show();
    const forked = rowOf('Rokas').getAllByRole('cell')[0];
    expect(forked?.textContent).toBe(badge.forked);
    expect(forked?.querySelector('a')).toBeNull();
  });

  it('says where a member has no assignment of a repertoire', () => {
    show();
    expect(rowOf('Gabija').getAllByRole('cell')[1]?.textContent).toBe(
      p.noAssignment,
    );
  });

  it('says there is nothing to learn when a repertoire has no own move', () => {
    show({
      columns: [column('r-1', 'Tuščias')],
      rows: [
        {
          player: { id: 'p-1', displayName: 'Gabija' },
          lastTrainedDays: 3,
          cells: [
            {
              status: STATUS,
              view: granted({ notStarted: 0, skipped: 0, due: 0, learned: 0 }),
            },
          ],
        },
      ],
    });
    const cell = cellOf('Gabija', /Tuščias/);
    expect(cell.textContent).toBe(p.nothing);
    expect(cell.getAttribute('aria-label')).toBe(
      `Gabija, Tuščias: ${p.nothing}`,
    );
  });

  it('says once, under the grid, that last trained counts only what the coach can see (R-154)', () => {
    show();
    expect(section().getAllByText(p.lastTrainedNote)).toHaveLength(1);
    expect(section().queryByText(/on the repertoires you can see/)).toBeNull();
  });

  it('says so when nothing is assigned to the group', () => {
    show({ columns: [], rows: [] });
    expect(section().getByText(p.gridEmpty)).toBeDefined();
    expect(section().queryByRole('table')).toBeNull();
    expect(section().queryByText(p.lastTrainedNote)).toBeNull();
  });
});
