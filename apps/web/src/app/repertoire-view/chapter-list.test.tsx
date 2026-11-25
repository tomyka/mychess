import { START_KEY, type Chapter } from '@mychess/chess';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { graphOf, LONDON } from '../../../test/fixtures/repertoires';
import { MESSAGES } from '../../i18n/catalogue';
import { ChapterList, type ChapterBuilder } from './chapter-list';
import type { FieldOutcome } from './field-save';

const server = vi.hoisted(() => ({
  count: vi.fn<(form: FormData) => Promise<unknown>>(),
}));

vi.mock('../repertuarai/know-actions', () => ({
  knowCountAction: server.count,
  markKnownAction: vi.fn(),
  learnAgainAction: vi.fn(),
}));

const REPERTOIRE = '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10';

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
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      <ChapterList
        chapters={chapters}
        chapterId={chapterId}
        names={{
          taxonomyNames: { c1: 'London System' },
          distinctions: {},
        }}
        onSelect={onSelect}
      />
    </NextIntlClientProvider>,
  );
  return onSelect;
}

const disclosure = () => screen.getByRole('button', { name: /Chapter 2 of 3/ });

describe('ChapterList', () => {
  it('shows the chosen chapter and where it is among them, closed', () => {
    renderList();
    expect(disclosure().getAttribute('aria-expanded')).toBe('false');
    expect(disclosure().textContent).toContain('Prieš karaliaus indą');
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('starts open on a desktop, but closed for a single chapter (R-116)', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(min-width: 1024px)',
    }));
    try {
      renderList();
      expect(disclosure().getAttribute('aria-expanded')).toBe('true');
      cleanup();
      renderList('c1', CHAPTERS.slice(0, 1));
      expect(
        screen
          .getByRole('button', { name: /Chapter 1 of 1/ })
          .getAttribute('aria-expanded'),
      ).toBe('false');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('lists every chapter by its title when opened', () => {
    renderList();
    fireEvent.click(disclosure());
    expect(disclosure().getAttribute('aria-expanded')).toBe('true');
    const rows = within(screen.getByRole('list')).getAllByRole('button');
    expect(rows.map((row) => row.textContent)).toEqual([
      'London System',
      'Prieš karaliaus indą',
      'Chapter 3',
    ]);
    expect(rows[1]?.getAttribute('aria-current')).toBe('true');
    expect(rows[0]?.getAttribute('aria-current')).toBeNull();
  });

  it('tells apart chapters named after the same opening (R-158)', () => {
    render(
      <NextIntlClientProvider locale="en" messages={MESSAGES}>
        <ChapterList
          chapters={[
            at('c1', { kind: 'eco', eco: 'B12' }),
            at('c2', { kind: 'custom', name: 'Mano' }),
            at('c5', { kind: 'eco', eco: 'B11' }),
          ]}
          chapterId="c5"
          names={{
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
          }}
          onSelect={vi.fn()}
        />
      </NextIntlClientProvider>,
    );
    const trigger = screen.getByRole('button', { name: /Chapter 3 of 3/ });
    expect(trigger.textContent).toContain(
      'Caro-Kann Defense (B11, 2.\u00A0Nc3)',
    );
    fireEvent.click(trigger);
    const rows = within(screen.getByRole('list')).getAllByRole('button');
    expect(rows.map((row) => row.textContent)).toEqual([
      'Caro-Kann Defense (B12, 3.\u00A0e5)',
      'Mano',
      'Caro-Kann Defense (B11, 2.\u00A0Nc3)',
    ]);
  });

  it('selects a chapter, closes the list and returns focus to the disclosure', () => {
    const onSelect = renderList();
    fireEvent.click(disclosure());
    fireEvent.click(screen.getByRole('button', { name: 'Chapter 3' }));
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

const c = MESSAGES.repertoires.chapters;

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
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      <ChapterList
        chapters={CHAPTERS}
        chapterId="c2"
        names={{
          taxonomyNames: { c1: 'London System' },
          distinctions: {},
        }}
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
    expect(named('Rename chapter London System')).toBeDefined();
    expect(named('Delete chapter Chapter 3')).toBeDefined();
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
    fireEvent.click(named('Rename chapter Chapter 3'));
    const field = screen.getByRole<HTMLInputElement>('textbox', {
      name: c.renameLabel,
    });
    expect(field.value).toBe('Chapter 3');
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(document.activeElement).toBe(named('Rename chapter Chapter 3'));
    fireEvent.click(named('Rename chapter Chapter 3'));
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
    render(
      <NextIntlClientProvider locale="en" messages={MESSAGES}>
        <ChapterList
          chapters={[
            at('c1', { kind: 'eco', eco: 'B12' }),
            at('c5', { kind: 'eco', eco: 'B11' }),
          ]}
          chapterId="c1"
          names={{
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
          }}
          onSelect={vi.fn()}
          builder={{
            disabled: false,
            onAdd: vi.fn(),
            onRename,
            onDelete: vi.fn(),
          }}
        />
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Chapter 1 of 2/ }));
    fireEvent.click(
      named('Rename chapter Caro-Kann Defense (B12, 3.\u00A0e5)'),
    );
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
    fireEvent.click(named('Rename chapter Chapter 3'));
    fireEvent.click(named(c.renameSubmit));
    expect(await screen.findByText(MESSAGES.chapter.nameBlank)).toBeDefined();
    expect(
      screen
        .getByRole('textbox', { name: c.renameLabel })
        .getAttribute('aria-invalid'),
    ).toBe('true');
  });

  it('deletes only after an inline confirmation, Cancel focused', () => {
    const builder = renderBuilder();
    fireEvent.click(named('Delete chapter London System'));
    expect(
      screen.getByText(
        'Delete chapter London System? Its moves that no other chapter uses are deleted with it.',
      ),
    ).toBeDefined();
    expect(document.activeElement).toBe(named(c.deleteCancel));
    fireEvent.click(named(c.deleteCancel));
    expect(builder.onDelete).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(named('Delete chapter London System'));
    fireEvent.click(named('Delete chapter London System'));
    fireEvent.click(named(c.deleteConfirm));
    expect(builder.onDelete).toHaveBeenCalledWith('c1');
  });

  it('disables every chapter edit while saving', () => {
    renderBuilder({ disabled: true });
    expect(named(c.add)).toHaveProperty('disabled', true);
    expect(named('Delete chapter Chapter 3')).toHaveProperty('disabled', true);
    expect(named('Rename chapter Chapter 3')).toHaveProperty('disabled', true);
  });
});

describe('ChapterList for a player who trains it (R-58, R-147)', () => {
  const toggles = () =>
    screen.queryAllByRole('button', { name: /^I know this or learn again: / });

  function renderTrained(training: boolean): void {
    render(
      <NextIntlClientProvider locale="en" messages={MESSAGES}>
        <ChapterList
          chapters={CHAPTERS}
          chapterId="c2"
          names={{
            taxonomyNames: { c1: 'London System' },
            distinctions: {},
          }}
          onSelect={vi.fn()}
          training={
            training
              ? {
                  repertoireId: REPERTOIRE,
                  counts: { due: 0, toLearn: 0 },
                  learn: {
                    tracked: [],
                    learnedToday: 0,
                    limits: { reviews: 20, newPerDay: 10 },
                  },
                  limitReached: false,
                }
              : undefined
          }
        />
      </NextIntlClientProvider>,
    );
    fireEvent.click(disclosure());
  }

  it('gives each chapter row its own menu, for that chapter', async () => {
    server.count.mockResolvedValue({ ok: true, know: 12, again: 0 });
    renderTrained(true);
    expect(toggles().map((b) => b.getAttribute('aria-label'))).toEqual([
      'I know this or learn again: London System',
      'I know this or learn again: Prieš karaliaus indą',
      'I know this or learn again: Chapter 3',
    ]);
    fireEvent.click(toggles()[1] ?? disclosure());
    fireEvent.click(
      await screen.findByRole('button', {
        name: MESSAGES.training.know.knowChapter,
      }),
    );
    expect(screen.getByText(/^Mark 12 moves as known?/u)).toBeDefined();
    const form = server.count.mock.lastCall?.[0];
    expect(form === undefined ? {} : Object.fromEntries(form)).toEqual({
      kind: 'chapter',
      repertoireId: REPERTOIRE,
      chapterId: 'c2',
    });
  });

  it('has no menu where the viewer does not train it', () => {
    renderTrained(false);
    expect(toggles()).toEqual([]);
  });
});

describe('ChapterList’s Learn on each chapter row (R-206)', () => {
  const london = graphOf(LONDON);
  const [first] = london.chapters;

  function renderLearn(learnedToday: number): void {
    render(
      <NextIntlClientProvider locale="en" messages={MESSAGES}>
        <ChapterList
          chapters={london.chapters}
          chapterId={first?.id ?? null}
          names={{ taxonomyNames: {}, distinctions: {} }}
          onSelect={vi.fn()}
          graph={london}
          training={{
            repertoireId: REPERTOIRE,
            counts: { due: 0, toLearn: 2 },
            learn: {
              tracked: [],
              learnedToday,
              limits: { reviews: 20, newPerDay: 2 },
            },
            limitReached: false,
          }}
        />
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Chapter 1 of/ }));
  }

  it('links each row to learning that chapter, with its count', () => {
    renderLearn(0);
    const links = screen.getAllByRole('link', {
      name: /^Learn 2 new moves in /,
    });
    expect(links.map((a) => a.getAttribute('href'))).toEqual(
      london.chapters.map(
        (c) => `/treniruote?mode=learn&r=${REPERTOIRE}&chapter=${c.id}`,
      ),
    );
    expect(links.map((a) => a.textContent)).toEqual(
      london.chapters.map(() => 'Learn (2)'),
    );
  });

  it('has no Learn on a row once today’s new moves are used', () => {
    renderLearn(2);
    expect(screen.queryByRole('link')).toBeNull();
  });
});
