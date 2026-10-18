import { START_KEY, type Chapter } from '@mychess/chess';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../../i18n/locales';
import { ChapterList, type ChapterBuilder } from './chapter-list';
import type { FieldOutcome } from './move-panel';

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

const c = MESSAGES.lt.repertoires.chapters;

function renderBuilder(over: Partial<ChapterBuilder> = {}) {
  const builder: ChapterBuilder = {
    disabled: false,
    onAdd: vi.fn(),
    onRename: vi
      .fn<(chapterId: string, name: string) => Promise<FieldOutcome>>()
      .mockResolvedValue({ ok: true }),
    onDelete: vi.fn(),
    ...over,
  };
  render(
    <NextIntlClientProvider locale="lt" messages={MESSAGES.lt}>
      <ChapterList
        chapters={CHAPTERS}
        chapterId="c2"
        ecoNames={{ D02: 'Londono sistema' }}
        onSelect={vi.fn()}
        builder={builder}
      />
    </NextIntlClientProvider>,
  );
  fireEvent.click(disclosure());
  return builder;
}

const named = (name: string) => screen.getByRole('button', { name });

describe('ChapterList in builder mode', () => {
  it('names each row’s rename and delete after its chapter', () => {
    renderBuilder();
    expect(named('Pervadinti skyrių „Londono sistema“')).toBeDefined();
    expect(named('Ištrinti skyrių „3 skyrius“')).toBeDefined();
  });

  it('adds a chapter from the end of the list and closes it', () => {
    const builder = renderBuilder();
    fireEvent.click(named(c.add));
    expect(builder.onAdd).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('list')).toBeNull();
    expect(document.activeElement).toBe(disclosure());
  });

  it('renames in place, and Escape cancels back to the rename button', async () => {
    const builder = renderBuilder();
    fireEvent.click(named('Pervadinti skyrių „3 skyrius“'));
    const field = screen.getByRole<HTMLInputElement>('textbox', {
      name: c.renameLabel,
    });
    expect(field.value).toBe('3 skyrius');
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(document.activeElement).toBe(named('Pervadinti skyrių „3 skyrius“'));
    fireEvent.click(named('Pervadinti skyrių „3 skyrius“'));
    fireEvent.change(screen.getByRole('textbox', { name: c.renameLabel }), {
      target: { value: 'Sistema su h3' },
    });
    fireEvent.click(named(c.renameSubmit));
    await waitFor(() => {
      expect(screen.queryByRole('textbox')).toBeNull();
    });
    expect(builder.onRename).toHaveBeenCalledWith('c3', 'Sistema su h3');
  });

  it('keeps the field and says why when a rename is refused', async () => {
    renderBuilder({
      onRename: vi.fn().mockResolvedValue({
        ok: false,
        refusal: 'chapter.nameBlank',
      }),
    });
    fireEvent.click(named('Pervadinti skyrių „3 skyrius“'));
    fireEvent.click(named(c.renameSubmit));
    expect(
      await screen.findByText(MESSAGES.lt.chapter.nameBlank),
    ).toBeDefined();
    expect(
      screen
        .getByRole('textbox', { name: c.renameLabel })
        .getAttribute('aria-invalid'),
    ).toBe('true');
  });

  it('deletes only after an inline confirmation, Cancel focused', () => {
    const builder = renderBuilder();
    fireEvent.click(named('Ištrinti skyrių „Londono sistema“'));
    expect(
      screen.getByText(
        'Ištrinti skyrių „Londono sistema“? Kartu bus ištrinti jo ėjimai, kurių nenaudoja joks kitas skyrius.',
      ),
    ).toBeDefined();
    expect(document.activeElement).toBe(named(c.deleteCancel));
    fireEvent.click(named(c.deleteCancel));
    expect(builder.onDelete).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(
      named('Ištrinti skyrių „Londono sistema“'),
    );
    fireEvent.click(named('Ištrinti skyrių „Londono sistema“'));
    fireEvent.click(named(c.deleteConfirm));
    expect(builder.onDelete).toHaveBeenCalledWith('c1');
  });

  it('disables every chapter edit while saving', () => {
    renderBuilder({ disabled: true });
    expect(named(c.add)).toHaveProperty('disabled', true);
    expect(named('Ištrinti skyrių „3 skyrius“')).toHaveProperty(
      'disabled',
      true,
    );
    expect(named('Pervadinti skyrių „3 skyrius“')).toHaveProperty(
      'disabled',
      true,
    );
  });
});
