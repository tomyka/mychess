import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../../i18n/locales';
import { RepertoireList, type RepertoireCard } from './repertoire-list';

const NOW = new Date('2026-10-18T12:00:00Z');

const card = (
  over: Partial<RepertoireCard> & Pick<RepertoireCard, 'id' | 'name'>,
): RepertoireCard => ({
  side: 'white',
  chapters: 2,
  moves: 148,
  updatedAt: NOW,
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

function renderList(
  items: readonly RepertoireCard[],
  locale: 'lt' | 'en' = 'lt',
): void {
  render(
    <NextIntlClientProvider
      locale={locale}
      messages={MESSAGES[locale]}
      timeZone="Europe/Vilnius"
    >
      <RepertoireList items={items} now={NOW} />
    </NextIntlClientProvider>,
  );
}

const l = MESSAGES.lt.repertoires.list;

const linksIn = (name: string) =>
  within(screen.getByRole('region', { name }))
    .getAllByRole('link')
    .map((link) => [link.getAttribute('href'), link.textContent]);

describe('RepertoireList', () => {
  it('groups White then Black, each sorted by name in the account’s language', () => {
    renderList(ITEMS);
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent),
    ).toEqual([l.white, l.black]);
    expect(linksIn(l.white)).toEqual([
      [
        '/repertuarai/r-1',
        'Londono sistema2 skyriai · 21 ėjimasPakeista 15:00',
      ],
      [
        '/repertuarai/r-2',
        'Šiaurės gambitas10 skyrių · 12 ėjimųPakeista 15:00',
      ],
      ['/repertuarai/r-3', 'Žaibas1 skyrius · 1 ėjimasPakeista 15:00'],
    ]);
    expect(linksIn(l.black)).toEqual([
      ['/repertuarai/r-4', 'Taimanovas6 skyriai · 233 ėjimaiPakeista 15:00'],
    ]);
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

  it('collapses to one line when there is no repertoire at all', () => {
    renderList([]);
    expect(screen.getByText(l.empty)).toBeDefined();
    expect(screen.queryAllByRole('heading')).toEqual([]);
  });

  it('shows older changes as a date, with the year when it is not this year', () => {
    renderList(
      [
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
      ],
      'en',
    );
    expect(linksIn(MESSAGES.en.repertoires.list.white)).toEqual([
      ['/repertuarai/a', 'A2 chapters · 148 movesChanged Oct 12'],
      ['/repertuarai/b', 'B2 chapters · 148 movesChanged Sep 2, 2025'],
    ]);
  });
});
