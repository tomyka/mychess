import type { Standing } from '@mychess/chess';
import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../../i18n/catalogue';
import type { AssignedListItem } from '../../server/assignment-pages';
import type { TrainedStanding } from '../../server/training';
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
  assignedTo: 0,
  teaching: false,
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

/** Jonas's Caro-Kann, assigned to the viewer, paused. */
const CARO: AssignedListItem = {
  repertoireId: 'a-1',
  name: 'Karo-Kan gynyba',
  side: 'black',
  chapters: 2,
  moves: 30,
  coachName: 'Jonas',
  deadline: null,
  badges: { ...NO_BADGES, paused: true },
};

/** Jonas's Italian, assigned to the viewer, past its deadline. */
const ITALIAN: AssignedListItem = {
  repertoireId: 'a-2',
  name: 'Itališkoji partija',
  side: 'white',
  chapters: 4,
  moves: 96,
  coachName: 'Jonas',
  deadline: '2026-10-01',
  badges: { ...NO_BADGES, overdue: true },
};

/** A trained standing of these counts, with its due count. */
const trained = (
  learned: number,
  due: number,
  notStarted: number,
  mastered = false,
): TrainedStanding => {
  const standing: Standing = {
    counts: { learned, due, notStarted, skipped: 0 },
    mastered,
  };
  return { standing, due };
};

function renderList(
  items: readonly RepertoireCard[],
  assigned: readonly AssignedListItem[] = [],
  standings: ReadonlyMap<string, TrainedStanding> = new Map(),
): void {
  render(
    <NextIntlClientProvider
      locale="en"
      messages={MESSAGES}
      timeZone="Europe/Vilnius"
    >
      <RepertoireList
        items={items}
        assigned={assigned}
        standings={standings}
        now={NOW}
      />
    </NextIntlClientProvider>,
  );
}

const l = MESSAGES.repertoires.list;

const hrefsIn = (name: string) =>
  within(screen.getByRole('region', { name }))
    .getAllByRole('link')
    .map((link) => link.getAttribute('href'));

const cardOf = (name: string) => screen.getByRole('link', { name });

describe('RepertoireList', () => {
  it('groups White then Black, each sorted by name', () => {
    renderList(ITEMS);
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent),
    ).toEqual([l.white, l.black]);
    expect(hrefsIn(l.white)).toEqual([
      '/repertoires/r-1',
      '/repertoires/r-2',
      '/repertoires/r-3',
    ]);
    expect(hrefsIn(l.black)).toEqual(['/repertoires/r-4']);
  });

  it('sorts by name in English order (R-160, #378)', () => {
    renderList([
      card({ id: 'r-j', name: 'Jonas' }),
      card({ id: 'r-y', name: 'Yra' }),
      card({ id: 'r-i', name: 'Ieva' }),
    ]);
    expect(hrefsIn(l.white)).toEqual([
      '/repertoires/r-i',
      '/repertoires/r-j',
      '/repertoires/r-y',
    ]);
  });

  it('gives an own card its counts, its change and its standing', () => {
    renderList(ITEMS, [], new Map([['r-1', trained(82, 3, 15)]]));
    const london = cardOf('Londono sistema');
    expect(within(london).getByText('2 chapters · 21 moves')).toBeDefined();
    expect(within(london).getByText('changed 15:00')).toBeDefined();
    expect(within(london).getByText('82% learned · 3 due')).toBeDefined();
    expect(london.getAttribute('title')).toBe('Londono sistema');
  });

  it('describes a card by its meta line and standing, not its name', () => {
    renderList(ITEMS, [], new Map([['r-1', trained(82, 3, 15)]]));
    const london = cardOf('Londono sistema');
    const described = (london.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent);
    expect(described).toEqual([
      '2 chapters · 21 moves · changed 15:00',
      '82% learned · 3 due',
    ]);
  });

  it('shows no standing for a repertoire the player does not train', () => {
    renderList(ITEMS, [], new Map([['r-1', trained(82, 3, 15)]]));
    expect(within(cardOf('Žaibas')).queryByText(/learned|New/u)).toBeNull();
  });

  it('says New on a repertoire with nothing started', () => {
    renderList(ITEMS, [], new Map([['r-2', trained(0, 0, 12)]]));
    expect(
      within(cardOf('Šiaurės gambitas')).getByText('New · 12 moves'),
    ).toBeDefined();
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
    expect(hrefsIn(l.white)).toEqual([
      '/repertoires/assigned/a-2',
      '/repertoires/r-1',
      '/repertoires/r-2',
      '/repertoires/r-3',
    ]);
    expect(hrefsIn(l.black)).toEqual([
      '/repertoires/assigned/a-1',
      '/repertoires/r-4',
    ]);
  });

  it('tags an assigned card and gives its coach, deadline, badges and standing', () => {
    renderList([], [CARO, ITALIAN], new Map([['a-2', trained(5, 1, 4)]]));
    const badge = MESSAGES.assignment.badge;
    const italian = cardOf('Itališkoji partija');
    expect(within(italian).getByText(l.tagAssigned)).toBeDefined();
    expect(within(italian).getByText('Jonas')).toBeDefined();
    expect(within(italian).getByText('due Oct 1')).toBeDefined();
    expect(within(italian).getByText('4 chapters · 96 moves')).toBeDefined();
    expect(within(italian).getByText(badge.overdue)).toBeDefined();
    expect(within(italian).getByText('50% learned · 1 due')).toBeDefined();
    const caro = cardOf('Karo-Kan gynyba');
    expect(within(caro).getByText(l.noDeadline)).toBeDefined();
    expect(within(caro).getByText(badge.paused)).toBeDefined();
    expect(within(caro).queryByText(badge.overdue)).toBeNull();
  });

  it('draws Paused as a pill like the other badges, not like a button', () => {
    renderList([], [CARO]);
    const paused = within(cardOf('Karo-Kan gynyba')).getByText(
      MESSAGES.assignment.badge.paused,
    );
    const forked = 'border-border-strong text-fg-muted'.split(' ');
    expect([...paused.classList]).toEqual(expect.arrayContaining(forked));
    expect(paused.classList.contains('bg-sunken')).toBe(false);
    expect(paused.classList.contains('text-fg')).toBe(false);
  });

  it('puts the badges in the name line, after the name and tag', () => {
    renderList([], [ITALIAN]);
    const italian = cardOf('Itališkoji partija');
    const nameLine =
      within(italian).getByText('Itališkoji partija').parentElement;
    expect(
      [...(nameLine?.querySelectorAll('span, li') ?? [])]
        .filter((el) => el.children.length === 0)
        .map((el) => el.textContent),
    ).toEqual([
      'Itališkoji partija',
      l.tagAssigned,
      MESSAGES.assignment.badge.overdue,
    ]);
  });

  it('says Mastered on a mastered repertoire’s card (R-178)', () => {
    renderList(ITEMS, [], new Map([['r-1', trained(21, 0, 0, true)]]));
    const london = cardOf('Londono sistema');
    expect(
      within(london).getByText(MESSAGES.coach.progress.mastered),
    ).toBeDefined();
    expect(within(london).queryByText(/learned/u)).toBeNull();
  });

  it('tags the player’s own copy of an assignment and names its coach, and nothing else (#328, R-135)', () => {
    renderList([
      card({ id: 'f-1', name: 'Itališkoji partija', forkCoachName: 'Jonas' }),
      card({ id: 'r-1', name: 'Londono sistema' }),
    ]);
    const label = l.forkOf.replace('{coach}', 'Jonas');
    const fork = cardOf('Itališkoji partija');
    expect(within(fork).getByText(l.tagFork)).toBeDefined();
    // The copy's origin comes after its size and change.
    expect(within(fork).getByText(label).parentElement?.textContent).toBe(
      `2 chapters · 148 moves · changed 15:00 · ${label}`,
    );
    const own = cardOf('Londono sistema');
    expect(within(own).queryByText(label)).toBeNull();
    expect(within(own).queryByText(l.tagFork)).toBeNull();
    expect(within(own).queryByText(l.tagAssigned)).toBeNull();
  });

  it('says how many players a coach’s repertoire is assigned to (R-225)', () => {
    renderList([
      card({ id: 'r-1', name: 'Londono sistema', assignedTo: 3 }),
      card({ id: 'r-2', name: 'Šiaurės gambitas' }),
    ]);
    expect(
      within(cardOf('Londono sistema')).getByText('Assigned to 3'),
    ).toBeDefined();
    expect(
      within(cardOf('Šiaurės gambitas')).queryByText(/Assigned to/u),
    ).toBeNull();
  });

  it('shows teaching material with its assignees and no own bar, share, due or New (R-230)', () => {
    renderList(
      [
        // With three players.
        card({
          id: 'r-1',
          name: 'Londono sistema',
          assignedTo: 3,
          teaching: true,
        }),
        // Only with a group that has no members yet.
        card({ id: 'r-2', name: 'Šiaurės gambitas', teaching: true }),
        card({ id: 'r-3', name: 'Žaibas' }),
      ],
      [],
      new Map([
        ['r-1', trained(82, 3, 15)],
        ['r-2', trained(0, 0, 12)],
        ['r-3', trained(82, 3, 15)],
      ]),
    );
    expect(
      within(cardOf('Londono sistema')).getByText('Assigned to 3'),
    ).toBeDefined();
    for (const name of ['Londono sistema', 'Šiaurės gambitas']) {
      const taught = cardOf(name);
      expect(within(taught).queryByText(/learned|due|New/u)).toBeNull();
      expect(taught.querySelector('[aria-hidden="true"]')).toBeNull();
      expect(taught.getAttribute('aria-describedby')?.split(' ')).toHaveLength(
        1,
      );
    }
    const own = cardOf('Žaibas');
    expect(within(own).getByText('82% learned · 3 due')).toBeDefined();
    expect(own.querySelector('[aria-hidden="true"]')).not.toBeNull();
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
    expect(within(cardOf('A')).getByText('changed Oct 12')).toBeDefined();
    expect(within(cardOf('B')).getByText('changed Sep 2, 2025')).toBeDefined();
  });

  it('shows a deadline in another year with its year', () => {
    renderList([], [{ ...ITALIAN, deadline: '2027-01-15' }]);
    expect(
      within(cardOf('Itališkoji partija')).getByText('due Jan 15, 2027'),
    ).toBeDefined();
  });
});
