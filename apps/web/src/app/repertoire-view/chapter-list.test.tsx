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
import { MESSAGES } from '../../i18n/locales';
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
    <NextIntlClientProvider locale="lt" messages={MESSAGES.lt}>
      <ChapterList
        chapters={chapters}
        chapterId={chapterId}
        names={{ ecoNames: { D02: 'Londono sistema' }, distinctions: {} }}
        onSelect={onSelect}
      />
    </NextIntlClientProvider>,
  );
  return onSelect;
}

const disclosure = () => screen.getByRole('button', { name: /Skyrius 2 iš 3/ });

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
          .getByRole('button', { name: /Skyrius 1 iš 1/ })
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
      'Londono sistema',
      'Prieš karaliaus indą',
      'Skyrius 3',
    ]);
    expect(rows[1]?.getAttribute('aria-current')).toBe('true');
    expect(rows[0]?.getAttribute('aria-current')).toBeNull();
  });

  it('tells apart chapters named after the same opening (R-158)', () => {
    render(
      <NextIntlClientProvider locale="lt" messages={MESSAGES.lt}>
        <ChapterList
          chapters={[
            at('c1', { kind: 'eco', eco: 'B12' }),
            at('c2', { kind: 'custom', name: 'Mano' }),
            at('c5', { kind: 'eco', eco: 'B11' }),
          ]}
          chapterId="c5"
          names={{
            ecoNames: { B12: 'Karo-Kano gynyba', B11: 'Karo-Kano gynyba' },
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
    const trigger = screen.getByRole('button', { name: /Skyrius 3 iš 3/ });
    expect(trigger.textContent).toContain(
      'Karo-Kano gynyba (B11, 2.\u00A0Nc3)',
    );
    fireEvent.click(trigger);
    const rows = within(screen.getByRole('list')).getAllByRole('button');
    expect(rows.map((row) => row.textContent)).toEqual([
      'Karo-Kano gynyba (B12, 3.\u00A0e5)',
      'Mano',
      'Karo-Kano gynyba (B11, 2.\u00A0Nc3)',
    ]);
  });

  it('selects a chapter, closes the list and returns focus to the disclosure', () => {
    const onSelect = renderList();
    fireEvent.click(disclosure());
    fireEvent.click(screen.getByRole('button', { name: 'Skyrius 3' }));
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
        names={{ ecoNames: { D02: 'Londono sistema' }, distinctions: {} }}
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
    expect(named('Ištrinti skyrių „Skyrius 3“')).toBeDefined();
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
    fireEvent.click(named('Pervadinti skyrių „Skyrius 3“'));
    const field = screen.getByRole<HTMLInputElement>('textbox', {
      name: c.renameLabel,
    });
    expect(field.value).toBe('Skyrius 3');
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(document.activeElement).toBe(named('Pervadinti skyrių „Skyrius 3“'));
    fireEvent.click(named('Pervadinti skyrių „Skyrius 3“'));
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
      <NextIntlClientProvider locale="lt" messages={MESSAGES.lt}>
        <ChapterList
          chapters={[
            at('c1', { kind: 'eco', eco: 'B12' }),
            at('c5', { kind: 'eco', eco: 'B11' }),
          ]}
          chapterId="c1"
          names={{
            ecoNames: { B12: 'Karo-Kano gynyba', B11: 'Karo-Kano gynyba' },
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
    fireEvent.click(screen.getByRole('button', { name: /Skyrius 1 iš 2/ }));
    fireEvent.click(
      named('Pervadinti skyrių „Karo-Kano gynyba (B12, 3.\u00A0e5)“'),
    );
    const field = screen.getByRole<HTMLInputElement>('textbox', {
      name: c.renameLabel,
    });
    expect(field.value).toBe('Karo-Kano gynyba');
    fireEvent.click(named(c.renameSubmit));
    await waitFor(() => {
      expect(onRename).toHaveBeenCalledWith('c1', 'Karo-Kano gynyba');
    });
  });

  it('keeps the field and says why when a rename is refused', async () => {
    renderBuilder({
      onRename: vi.fn().mockResolvedValue({
        ok: false,
        refusal: 'chapter.nameBlank',
      }),
    });
    fireEvent.click(named('Pervadinti skyrių „Skyrius 3“'));
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
    expect(named('Ištrinti skyrių „Skyrius 3“')).toHaveProperty(
      'disabled',
      true,
    );
    expect(named('Pervadinti skyrių „Skyrius 3“')).toHaveProperty(
      'disabled',
      true,
    );
  });
});

describe('ChapterList for a player who trains it (R-58, R-147)', () => {
  const toggles = () =>
    screen.queryAllByRole('button', { name: /^Žinau arba mokytis iš naujo: / });

  function renderTrained(training: boolean): void {
    render(
      <NextIntlClientProvider locale="lt" messages={MESSAGES.lt}>
        <ChapterList
          chapters={CHAPTERS}
          chapterId="c2"
          names={{ ecoNames: { D02: 'Londono sistema' }, distinctions: {} }}
          onSelect={vi.fn()}
          training={
            training
              ? {
                  repertoireId: REPERTOIRE,
                  counts: { due: 0, toLearn: 0 },
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
      'Žinau arba mokytis iš naujo: Londono sistema',
      'Žinau arba mokytis iš naujo: Prieš karaliaus indą',
      'Žinau arba mokytis iš naujo: Skyrius 3',
    ]);
    fireEvent.click(toggles()[1] ?? disclosure());
    fireEvent.click(
      await screen.findByRole('button', {
        name: MESSAGES.lt.training.know.knowChapter,
      }),
    );
    expect(screen.getByText(/^Pažymėti, kad žinote 12 ėjimų?/u)).toBeDefined();
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
