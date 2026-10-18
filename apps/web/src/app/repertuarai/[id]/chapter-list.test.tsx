import { START_KEY, type Chapter } from '@mychess/chess';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../../i18n/locales';
import { ChapterList } from './chapter-list';

const at = (id: string, nameSource: Chapter['nameSource']): Chapter => ({
  id,
  rootKey: START_KEY,
  intro: null,
  nameSource,
});

const CHAPTERS: readonly Chapter[] = [
  at('c1', { kind: 'eco', eco: 'D02' }),
  at('c2', { kind: 'custom', name: 'Prieš karaliaus indą' }),
  at('c3', { kind: 'index', number: 3 }),
];

function renderList(chapterId = 'c2', chapters = CHAPTERS) {
  const onSelect = vi.fn<(chapterId: string) => void>();
  render(
    <NextIntlClientProvider locale="lt" messages={MESSAGES.lt}>
      <ChapterList
        chapters={chapters}
        chapterId={chapterId}
        ecoNames={{ D02: 'Londono sistema' }}
        onSelect={onSelect}
      />
    </NextIntlClientProvider>,
  );
  return onSelect;
}

const disclosure = () => screen.getByRole('button', { name: /2 skyrius iš 3/ });

describe('ChapterList', () => {
  it('shows the chosen chapter and where it is among them, closed', () => {
    renderList();
    expect(disclosure().getAttribute('aria-expanded')).toBe('false');
    expect(disclosure().textContent).toContain('Prieš karaliaus indą');
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('lists every chapter by its title when opened', () => {
    renderList();
    fireEvent.click(disclosure());
    expect(disclosure().getAttribute('aria-expanded')).toBe('true');
    const rows = within(screen.getByRole('list')).getAllByRole('button');
    expect(rows.map((row) => row.textContent)).toEqual([
      'Londono sistema',
      'Prieš karaliaus indą',
      '3 skyrius',
    ]);
    expect(rows[1]?.getAttribute('aria-current')).toBe('true');
    expect(rows[0]?.getAttribute('aria-current')).toBeNull();
  });

  it('selects a chapter, closes the list and returns focus to the disclosure', () => {
    const onSelect = renderList();
    fireEvent.click(disclosure());
    fireEvent.click(screen.getByRole('button', { name: '3 skyrius' }));
    expect(onSelect).toHaveBeenCalledWith('c3');
    expect(screen.queryByRole('list')).toBeNull();
    expect(document.activeElement).toBe(disclosure());
  });

  it('offers no rename or delete while browsing', () => {
    renderList();
    fireEvent.click(disclosure());
    expect(screen.getAllByRole('button')).toHaveLength(4);
  });

  it('shows nothing for a repertoire without chapters', () => {
    renderList('c1', []);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
