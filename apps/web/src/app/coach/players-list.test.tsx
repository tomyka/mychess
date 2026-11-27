import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../../i18n/catalogue';
import type { DashboardPlayerLine } from '../../server/coach-pages';
import { PlayersList } from './players-list';

const p = MESSAGES.coach.players;
const TODAY = '2026-11-27';

const SUMMARY: DashboardPlayerLine['summary'] = {
  counts: { learned: 10, due: 43, skipped: 0, notStarted: 47 },
  nextDeadline: '2026-11-30',
  allDone: false,
  overdue: false,
};

const ROKAS: DashboardPlayerLine = {
  id: 'p-1',
  displayName: 'Rokas',
  lastTrainedDays: 5,
  summary: SUMMARY,
};
const GABIJA: DashboardPlayerLine = {
  id: 'p-2',
  displayName: 'Gabija',
  lastTrainedDays: null,
  summary: { counts: null, nextDeadline: null, allDone: false, overdue: false },
};
const EGLE: DashboardPlayerLine = {
  id: 'p-3',
  displayName: 'Eglė',
  lastTrainedDays: 0,
  summary: {
    counts: { learned: 20, due: 0, skipped: 0, notStarted: 0 },
    nextDeadline: null,
    allDone: true,
    overdue: false,
  },
};

function renderList(players: readonly DashboardPlayerLine[]): void {
  render(
    <NextIntlClientProvider
      locale="en"
      messages={MESSAGES}
      timeZone="Europe/Vilnius"
    >
      <PlayersList players={players} today={TODAY} />
    </NextIntlClientProvider>,
  );
}

/** The phone list (the table is the same players from md). */
const phoneList = () => within(screen.getByRole('list'));

/** A player's row in the phone list. */
const phoneRow = (name: string) =>
  within(
    phoneList().getByRole('link', { name }).closest('li') ?? document.body,
  );

/** A player's row in the desktop table. */
const tableRow = (name: string) =>
  within(
    within(screen.getByRole('table'))
      .getByRole('link', { name })
      .closest('tr') ?? document.body,
  );

describe('PlayersList (R-231)', () => {
  it('says how to get a first player', () => {
    renderList([]);
    expect(
      screen.getByRole('heading', { level: 2, name: 'Players · 0' }),
    ).toBeDefined();
    expect(screen.getByText(p.empty)).toBeDefined();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('heads the list with its count and links each row to the player', () => {
    renderList([ROKAS, GABIJA]);
    expect(
      screen.getByRole('heading', { level: 2, name: 'Players · 2' }),
    ).toBeDefined();
    expect(
      phoneList()
        .getAllByRole('link')
        .map((link) => [link.textContent, link.getAttribute('href')]),
    ).toEqual([
      ['Rokas', '/coach/players/p-1'],
      ['Gabija', '/coach/players/p-2'],
    ]);
  });

  it('gives last trained, % learned, the due count and the next deadline', () => {
    renderList([ROKAS]);
    const row = phoneRow('Rokas');
    expect(row.getByText('5 days ago')).toBeDefined();
    expect(row.getByText('10% learned')).toBeDefined();
    expect(row.getByText('43 due').className).toContain('text-due');
    expect(row.getByText('by Nov 30')).toBeDefined();
    expect(
      row.getByText('10% learned').parentElement?.querySelector('.h-1\\.5'),
    ).not.toBeNull();
  });

  it('leaves out a zero due count and shows Done when every assignment is', () => {
    renderList([EGLE]);
    const row = phoneRow('Eglė');
    expect(row.getByText('today')).toBeDefined();
    expect(row.queryByText(/due/u)).toBeNull();
    expect(row.getByText(MESSAGES.coach.status.done).className).toContain(
      'rounded-pill',
    );
  });

  it('shows Overdue in place of the next deadline', () => {
    renderList([
      {
        ...ROKAS,
        summary: { ...SUMMARY, nextDeadline: '2026-11-20', overdue: true },
      },
    ]);
    const row = phoneRow('Rokas');
    expect(row.getByText(MESSAGES.assignment.badge.overdue)).toBeDefined();
    expect(row.queryByText(/^by /u)).toBeNull();
  });

  it('says when the coach may see nothing of a player', () => {
    renderList([GABIJA]);
    const row = phoneRow('Gabija');
    expect(row.getByText('never')).toBeDefined();
    expect(row.getByText(p.nothing)).toBeDefined();
  });

  it('has no Unlink: that is on the player page', () => {
    renderList([ROKAS, GABIJA]);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('says once what last trained counts', () => {
    renderList([ROKAS, GABIJA]);
    expect(
      screen.getAllByText(MESSAGES.coach.progress.lastTrainedNote),
    ).toHaveLength(1);
  });

  it('is a list on a phone and a table from md, with the same players', () => {
    renderList([ROKAS, GABIJA]);
    const list = screen.getByRole('list');
    const table = screen.getByRole('table');
    expect(list.className).toContain('md:hidden');
    expect(table.className.split(' ')).toEqual(
      expect.arrayContaining(['hidden', 'md:table']),
    );
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['Player', 'Progress', 'Due', 'Next deadline', 'Last trained']);
    expect(
      within(table)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Rokas', 'Gabija']);
  });

  it('fills the table’s columns for each player', () => {
    renderList([ROKAS, GABIJA, EGLE]);
    expect(
      tableRow('Rokas')
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['Rokas', '10% learned', '43', 'Nov 30', '5 days ago']);
    expect(
      tableRow('Gabija')
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['Gabija', p.nothing, '', '', 'never']);
    expect(
      tableRow('Eglė')
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['Eglė', '100% learned', '0', 'Done', 'today']);
  });
});
