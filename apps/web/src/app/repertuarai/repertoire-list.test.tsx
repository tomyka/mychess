import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../../i18n/catalogue';
import type { AssignedListItem } from '../../server/assignment-pages';
import { RepertoireList, type RepertoireCard } from './repertoire-list';

const NOW = new Date('2026-10-18T12:00:00Z');

const card = (
  over: Partial<RepertoireCard> & Pick<RepertoireCard, 'id' | 'name'>,
): RepertoireCard => ({
  side: 'white',
  chapters: 2,
  moves: 148,
  updatedAt: NOW,
  forkCoachName: null,
  ...over,
});

const ITEMS: readonly RepertoireCard[] = [
  card({ id: 'r-3', name: 'Žaibas', chapters: 1, moves: 1 }),
  card({ id: 'r-1', name: 'Londono sistema', chapters: 2, moves: 21 }),
  card({ id: 'r-2', name: 'Šiaurės gambitas', chapters: 10, moves: 12 }),
  card({
    id: 'r-4',
    name: 'Taimanovas',
    side: 'black',
    chapters: 6,
    moves: 233,
  }),
];

const NO_BADGES = {
  overdue: false,
  paused: false,
  forked: false,
  updated: false,
};

/** Jonas's Caro-Kann, assigned to the viewer. */
const CARO: AssignedListItem = {
  repertoireId: 'a-1',
  name: 'Karo-Kan gynyba',
  side: 'black',
  coachName: 'Jonas',
  deadline: null,
  badges: { ...NO_BADGES, updated: true },
};

/** Jonas's Italian, assigned to the viewer, past its deadline. */
const ITALIAN: AssignedListItem = {
  repertoireId: 'a-2',
  name: 'Itališkoji partija',
  side: 'white',
  coachName: 'Jonas',
  deadline: '2026-10-01',
  badges: { ...NO_BADGES, overdue: true },
};

function renderList(
  items: readonly RepertoireCard[],
  assigned: readonly AssignedListItem[] = [],
): void {
  render(
    <NextIntlClientProvider
      locale="en"
      messages={MESSAGES}
      timeZone="Europe/Vilnius"
    >
      <RepertoireList items={items} assigned={assigned} now={NOW} />
    </NextIntlClientProvider>,
  );
}

const l = MESSAGES.repertoires.list;

const linksIn = (name: string) =>
  within(screen.getByRole('region', { name }))
    .getAllByRole('link')
    .map((link) => [link.getAttribute('href'), link.textContent]);

describe('RepertoireList', () => {
  it('groups White then Black, each sorted by name', () => {
    renderList(ITEMS);
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent),
    ).toEqual([l.white, l.black]);
    expect(linksIn(l.white)).toEqual([
      ['/repertuarai/r-1', 'Londono sistema2 chapters · 21 movesChanged 15:00'],
      [
        '/repertuarai/r-2',
        'Šiaurės gambitas10 chapters · 12 movesChanged 15:00',
      ],
      ['/repertuarai/r-3', 'Žaibas1 chapter · 1 moveChanged 15:00'],
    ]);
    expect(linksIn(l.black)).toEqual([
      ['/repertuarai/r-4', 'Taimanovas6 chapters · 233 movesChanged 15:00'],
    ]);
  });

  it('sorts by name in English order (R-160, #378)', () => {
    renderList([
      card({ id: 'r-j', name: 'Jonas' }),
      card({ id: 'r-y', name: 'Yra' }),
      card({ id: 'r-i', name: 'Ieva' }),
    ]);
    expect(
      linksIn(MESSAGES.repertoires.list.white).map(([href]) => href),
    ).toEqual(['/repertuarai/r-i', '/repertuarai/r-j', '/repertuarai/r-y']);
  });

  it('names each card by its repertoire and describes it by its counts', () => {
    renderList(ITEMS);
    const link = screen.getByRole('link', { name: 'Londono sistema' });
    expect(link.getAttribute('aria-describedby')).not.toBeNull();
  });

  it('says when one side has no repertoire', () => {
    renderList(ITEMS.slice(0, 1));
    expect(
      within(screen.getByRole('region', { name: l.black })).getByText(
        l.emptyBlack,
      ),
    ).toBeDefined();
  });

  it('lists the repertoires assigned to the player under their side, sorted with the own ones (#328)', () => {
    renderList(ITEMS, [CARO, ITALIAN]);
    expect(linksIn(l.white).map(([href]) => href)).toEqual([
      '/repertuarai/priskirti/a-2',
      '/repertuarai/r-1',
      '/repertuarai/r-2',
      '/repertuarai/r-3',
    ]);
    expect(linksIn(l.black).map(([href]) => href)).toEqual([
      '/repertuarai/priskirti/a-1',
      '/repertuarai/r-4',
    ]);
  });

  it('marks an assigned repertoire with its coach, deadline and badges, as home does', () => {
    renderList([], [CARO, ITALIAN]);
    const a = MESSAGES.assignment;
    const caro = screen.getByRole('link', { name: 'Karo-Kan gynyba' });
    expect(within(caro).getByText('Assigned by Jonas')).toBeDefined();
    expect(within(caro).getByText(a.badge.updated)).toBeDefined();
    expect(within(caro).queryByText(a.badge.overdue)).toBeNull();
    const italian = screen.getByRole('link', { name: 'Itališkoji partija' });
    expect(within(italian).getByText(a.badge.overdue)).toBeDefined();
    expect(within(italian).getByText(/^Deadline/u).textContent).toMatch(
      /2026/u,
    );
  });

  it('labels the player’s own copy of an assignment with its coach, and nothing else (#328, R-135)', () => {
    renderList([
      card({ id: 'f-1', name: 'Itališkoji partija', forkCoachName: 'Jonas' }),
      card({ id: 'r-1', name: 'Londono sistema' }),
    ]);
    const label = l.forkOf.replace('{coach}', 'Jonas');
    const fork = screen.getByRole('link', { name: 'Itališkoji partija' });
    expect(within(fork).getByText(label)).toBeDefined();
    const own = screen.getByRole('link', { name: 'Londono sistema' });
    expect(within(own).queryByText(label)).toBeNull();
  });

  it('says a side is empty only when it has neither an own nor an assigned repertoire', () => {
    renderList([], [CARO]);
    expect(screen.queryByText(l.emptyBlack)).toBeNull();
    expect(screen.queryByText(l.empty)).toBeNull();
    expect(
      within(screen.getByRole('region', { name: l.white })).getByText(
        l.emptyWhite,
      ),
    ).toBeDefined();
  });

  it('collapses to one line when there is no repertoire at all', () => {
    renderList([]);
    expect(screen.getByText(l.empty)).toBeDefined();
    expect(screen.queryAllByRole('heading')).toEqual([]);
  });

  it('shows older changes as a date, with the year when it is not this year', () => {
    renderList([
      card({
        id: 'a',
        name: 'A',
        updatedAt: new Date('2026-10-12T09:00:00Z'),
      }),
      card({
        id: 'b',
        name: 'B',
        updatedAt: new Date('2025-09-02T09:00:00Z'),
      }),
    ]);
    expect(linksIn(MESSAGES.repertoires.list.white)).toEqual([
      ['/repertuarai/a', 'A2 chapters · 148 movesChanged Oct 12'],
      ['/repertuarai/b', 'B2 chapters · 148 movesChanged Sep 2, 2025'],
    ]);
  });

  it('shows a change today on a 24-hour clock (#330 decision 6)', () => {
    renderList([card({ id: 'a', name: 'A' })]);
    expect(linksIn(MESSAGES.repertoires.list.white)).toEqual([
      ['/repertuarai/a', 'A2 chapters · 148 movesChanged 15:00'],
    ]);
  });
});
