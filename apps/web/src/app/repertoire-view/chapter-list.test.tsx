import { START_KEY, type Chapter, type Standing } from '@mychess/chess';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../i18n/catalogue';
import {
  ChapterList,
  type ChapterBuilder,
  type ChapterListProps,
} from './chapter-list';
import type { FieldOutcome } from './field-save';

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

function renderList(over: Partial<ChapterListProps> = {}) {
  const onSelect = vi.fn<(chapterId: string) => void>();
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      <ChapterList
        chapters={CHAPTERS}
        chapterId="c2"
        names={{
          taxonomyNames: { c1: 'London System' },
          distinctions: {},
        }}
        onSelect={onSelect}
        {...over}
      />
    </NextIntlClientProvider>,
  );
  return onSelect;
}

const disclosure = () =>
  screen.getByRole('button', { name: 'Ch 2/3 · Prieš karaliaus indą' });

const rowButtons = () =>
  within(screen.getByRole('list')).getAllByRole('button');

describe('ChapterList', () => {
  it('shows the chosen chapter as one closed line: "Ch 2/3 · <label>" (spec, Chapter line)', () => {
    renderList();
    expect(disclosure().getAttribute('aria-expanded')).toBe('false');
    expect(disclosure().textContent).toBe('Ch 2/3 · Prieš karaliaus indą');
    expect(disclosure().querySelector('.truncate')?.textContent).toBe(
      'Ch 2/3 · Prieš karaliaus indą',
    );
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('stays closed by default on a desktop too', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(min-width: 1024px)',
    }));
    try {
      renderList();
      expect(disclosure().getAttribute('aria-expanded')).toBe('false');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('lists every chapter by its title when opened, with no scroller of its own', () => {
    renderList();
    fireEvent.click(disclosure());
    expect(disclosure().getAttribute('aria-expanded')).toBe('true');
    const rows = rowButtons();
    expect(rows.map((row) => row.textContent)).toEqual([
      'London System',
      'Prieš karaliaus indą',
      'Chapter 3',
    ]);
    expect(rows[1]?.getAttribute('aria-current')).toBe('true');
    expect(rows[0]?.getAttribute('aria-current')).toBeNull();
    const list = screen.getByRole('list');
    expect(list.className).not.toMatch(/max-h-|overflow-y-auto/);
  });

  it('tells apart chapters named after the same opening (R-158)', () => {
    renderList({
      chapters: [
        at('c1', { kind: 'eco', eco: 'B12' }),
        at('c2', { kind: 'custom', name: 'Mano' }),
        at('c5', { kind: 'eco', eco: 'B11' }),
      ],
      chapterId: 'c5',
      names: {
        taxonomyNames: { c1: 'Caro-Kann Defense', c5: 'Caro-Kann Defense' },
        distinctions: {
          c1: {
            eco: 'B12',
            firstMove: { ply: 4, san: 'e5', whiteFirst: true },
          },
          c2: {
            eco: 'B10',
            firstMove: { ply: 2, san: 'c4', whiteFirst: true },
          },
          c5: {
            eco: 'B11',
            firstMove: { ply: 2, san: 'Nc3', whiteFirst: true },
          },
        },
      },
    });
    const trigger = screen.getByRole('button', {
      name: 'Ch 3/3 · Caro-Kann Defense (B11, 2. Nc3)',
    });
    fireEvent.click(trigger);
    expect(rowButtons().map((row) => row.textContent)).toEqual([
      'Caro-Kann Defense (B12, 3. e5)',
      'Mano',
      'Caro-Kann Defense (B11, 2. Nc3)',
    ]);
  });

  it('selects a chapter, closes the list and returns focus to the line', () => {
    const onSelect = renderList();
    fireEvent.click(disclosure());
    fireEvent.click(screen.getByRole('button', { name: 'Chapter 3' }));
    expect(onSelect).toHaveBeenCalledWith('c3');
    expect(screen.queryByRole('list')).toBeNull();
    expect(document.activeElement).toBe(disclosure());
  });

  it('offers no rename, delete, Learn or "I know this" while browsing', () => {
    renderList({ standings: STANDINGS });
    fireEvent.click(disclosure());
    expect(screen.getAllByRole('button')).toHaveLength(4);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('shows nothing for a repertoire without chapters', () => {
    renderList({ chapters: [], chapterId: 'c1' });
    expect(screen.queryByRole('button')).toBeNull();
  });
});

const standing = (counts: Standing['counts'], mastered = false): Standing => ({
  counts,
  mastered,
});

const STANDINGS: Readonly<Record<string, Standing>> = {
  c1: standing({ notStarted: 2, skipped: 0, due: 4, learned: 4 }),
  c2: standing({ notStarted: 18, skipped: 0, due: 0, learned: 0 }),
  c3: standing({ notStarted: 0, skipped: 0, due: 0, learned: 6 }, true),
};

describe('ChapterList’s progress rows (R-225)', () => {
  it('shows each chapter’s standing under its title, with its due count', () => {
    renderList({ standings: STANDINGS });
    fireEvent.click(disclosure());
    const rows = rowButtons();
    expect(
      within(rows[0] ?? document.body).getByText('40% learned · 4 due'),
    ).toBeDefined();
    expect(
      within(rows[1] ?? document.body).getByText('New · 18 moves'),
    ).toBeDefined();
    expect(
      within(rows[2] ?? document.body).getByText('Mastered'),
    ).toBeDefined();
  });

  it('names each row by its title alone, its standing describing it', () => {
    renderList({ standings: STANDINGS });
    fireEvent.click(disclosure());
    const london = screen.getByRole('button', { name: 'London System' });
    const described = london.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(described)?.textContent).toBe(
      '40% learned · 4 due',
    );
  });

  it('shows titles alone without standings', () => {
    renderList();
    fireEvent.click(disclosure());
    expect(screen.queryByText(/learned|Mastered|New ·/)).toBeNull();
  });
});

const c = MESSAGES.repertoires.chapters;

function renderBuilder(over: Partial<ChapterBuilder> = {}, chapterId = 'c2') {
  const builder: ChapterBuilder = {
    disabled: false,
    onAdd: vi.fn(),
    onRename: vi
      .fn<(chapterId: string, name: string) => Promise<FieldOutcome>>()
      .mockResolvedValue({ ok: true }),
    onDelete: vi.fn(),
    ...over,
  };
  renderList({ builder, chapterId });
  fireEvent.click(screen.getByRole('button', { name: /^Ch \d\/3 · / }));
  return builder;
}

const named = (name: string) => screen.getByRole('button', { name });

describe('ChapterList in builder mode', () => {
  it('puts labelled Rename chapter and Delete chapter under the current chapter’s title only', () => {
    renderBuilder();
    expect(screen.getAllByRole('button', { name: c.renameShort })).toHaveLength(
      1,
    );
    expect(screen.getAllByRole('button', { name: c.deleteShort })).toHaveLength(
      1,
    );
    const current = named('Prieš karaliaus indą');
    expect(precedes(current, named(c.renameShort))).toBe(true);
    expect(precedes(named(c.deleteShort), named('Chapter 3'))).toBe(true);
    expect(named(c.renameShort).textContent).toBe(c.renameShort);
  });

  it('adds a chapter from the end of the list and closes it', () => {
    const builder = renderBuilder();
    fireEvent.click(named(c.add));
    expect(builder.onAdd).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('list')).toBeNull();
    expect(document.activeElement).toBe(disclosure());
  });

  it('renames in place, and Escape cancels back to Rename chapter', async () => {
    const builder = renderBuilder({}, 'c3');
    fireEvent.click(named(c.renameShort));
    const field = screen.getByRole<HTMLInputElement>('textbox', {
      name: c.renameLabel,
    });
    expect(field.value).toBe('Chapter 3');
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(document.activeElement).toBe(named(c.renameShort));
    fireEvent.click(named(c.renameShort));
    fireEvent.change(screen.getByRole('textbox', { name: c.renameLabel }), {
      target: { value: 'Sistema su h3' },
    });
    fireEvent.click(named(c.renameSubmit));
    await waitFor(() => {
      expect(screen.queryByRole('textbox')).toBeNull();
    });
    expect(builder.onRename).toHaveBeenCalledWith('c3', 'Sistema su h3');
  });

  it('starts renaming one of two same-named chapters from its own name (R-158)', async () => {
    const onRename = vi
      .fn<(chapterId: string, name: string) => Promise<FieldOutcome>>()
      .mockResolvedValue({ ok: true });
    renderList({
      chapters: [
        at('c1', { kind: 'eco', eco: 'B12' }),
        at('c5', { kind: 'eco', eco: 'B11' }),
      ],
      chapterId: 'c1',
      names: {
        taxonomyNames: { c1: 'Caro-Kann Defense', c5: 'Caro-Kann Defense' },
        distinctions: {
          c1: {
            eco: 'B12',
            firstMove: { ply: 4, san: 'e5', whiteFirst: true },
          },
          c5: {
            eco: 'B11',
            firstMove: { ply: 2, san: 'Nc3', whiteFirst: true },
          },
        },
      },
      builder: { disabled: false, onAdd: vi.fn(), onRename, onDelete: vi.fn() },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Ch 1\/2 · / }));
    fireEvent.click(named(c.renameShort));
    const field = screen.getByRole<HTMLInputElement>('textbox', {
      name: c.renameLabel,
    });
    expect(field.value).toBe('Caro-Kann Defense');
    fireEvent.click(named(c.renameSubmit));
    await waitFor(() => {
      expect(onRename).toHaveBeenCalledWith('c1', 'Caro-Kann Defense');
    });
  });

  it('keeps the field and says why when a rename is refused', async () => {
    renderBuilder({
      onRename: vi.fn().mockResolvedValue({
        ok: false,
        refusal: 'chapter.nameBlank',
      }),
    });
    fireEvent.click(named(c.renameShort));
    fireEvent.click(named(c.renameSubmit));
    expect(await screen.findByText(MESSAGES.chapter.nameBlank)).toBeDefined();
    expect(
      screen
        .getByRole('textbox', { name: c.renameLabel })
        .getAttribute('aria-invalid'),
    ).toBe('true');
  });

  it('deletes only after an inline confirmation, Cancel focused', () => {
    const builder = renderBuilder({}, 'c1');
    fireEvent.click(named(c.deleteShort));
    expect(
      screen.getByText(
        'Delete chapter London System? Its moves that no other chapter uses are deleted with it.',
      ),
    ).toBeDefined();
    expect(document.activeElement).toBe(named(c.deleteCancel));
    fireEvent.click(named(c.deleteCancel));
    expect(builder.onDelete).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(named(c.deleteShort));
    fireEvent.click(named(c.deleteShort));
    fireEvent.click(named(c.deleteConfirm));
    expect(builder.onDelete).toHaveBeenCalledWith('c1');
  });

  it('disables every chapter edit while saving', () => {
    renderBuilder({ disabled: true });
    expect(named(c.add)).toHaveProperty('disabled', true);
    expect(named(c.deleteShort)).toHaveProperty('disabled', true);
    expect(named(c.renameShort)).toHaveProperty('disabled', true);
  });
});

/** Whether `a` comes before `b` in the document. */
function precedes(a: Element, b: Element): boolean {
  return (
    (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
  );
}
