import type { Config } from '@lichess-org/chessground/config';
import type { Key } from '@lichess-org/chessground/types';
import {
  addMove,
  fenOf,
  moveKey,
  START_KEY,
  type RepertoireGraph,
} from '@mychess/chess';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { createTranslator, NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { graphOf, LONDON } from '../../../../test/fixtures/repertoires';
import { MESSAGES } from '../../../i18n/locales';
import { chapterTitle, ecoNamesOf } from '../../../server/chapter-names';
import type { NoteOutcome } from './actions';
import { RepertoireScreen } from './repertoire-screen';

const ground = vi.hoisted(() => {
  const created: Config[] = [];
  return { created, set: vi.fn<(config: Config) => void>() };
});

vi.mock('@lichess-org/chessground', () => ({
  Chessground: (_element: HTMLElement, config: Config) => {
    ground.created.push(config);
    return {
      set: ground.set,
      setShapes: vi.fn(),
      selectSquare: vi.fn(),
      destroy: vi.fn(),
      state: { drawable: { current: undefined } },
    };
  },
}));

const server = vi.hoisted(() => ({
  saveNote: vi.fn<(input: unknown) => Promise<NoteOutcome>>(),
  refresh: vi.fn<() => void>(),
}));

vi.mock('./actions', () => ({
  savePersonalNoteAction: server.saveNote,
  renameRepertoireAction: vi.fn(),
  deleteRepertoireAction: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: server.refresh }),
}));

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a value');
  return value;
}

const ID = '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10';
const GRAPH = graphOf(LONDON);
const lt = MESSAGES.lt;
const r = lt.repertoires;

function renderScreen(
  graph: RepertoireGraph = GRAPH,
  name = 'Londono sistema',
) {
  render(
    <NextIntlClientProvider locale="lt" messages={lt}>
      <RepertoireScreen
        repertoire={{ id: ID, name, side: graph.side, version: 3 }}
        graph={graph}
        notes={{}}
        ecoNames={ecoNamesOf(graph, 'lt')}
      />
    </NextIntlClientProvider>,
  );
}

const current = () =>
  document.querySelector('[aria-current="true"][aria-label]')?.textContent;

/** Plays a move on the (mocked) board, as chessground reports it. */
function boardMove(orig: Key, dest: Key): void {
  act(() => {
    ground.created.at(-1)?.movable?.events?.after?.(orig, dest, {
      premove: false,
    });
  });
}

beforeEach(() => {
  ground.created.length = 0;
  ground.set.mockReset();
  server.saveNote.mockReset().mockResolvedValue({ ok: true });
  server.refresh.mockReset();
});

describe('RepertoireScreen: browsing', () => {
  it('names the board after the repertoire and the chapter', () => {
    renderScreen();
    const title = chapterTitle(
      createTranslator({ locale: 'lt', messages: lt }),
      'lt',
    );
    expect(
      screen.getByRole('application', {
        name: `Šachmatų lenta, Londono sistema, ${title(must(GRAPH.chapters[0]))}`,
      }),
    ).toBeDefined();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Londono sistema' }),
    ).toBeDefined();
  });

  it('starts at the chapter root with the intro, back disabled', () => {
    renderScreen();
    expect(screen.getByText('The London')).toBeDefined();
    expect(screen.getByRole('button', { name: r.nav.back })).toHaveProperty(
      'disabled',
      true,
    );
    expect(screen.getByRole('button', { name: r.nav.start })).toHaveProperty(
      'disabled',
      true,
    );
    expect(current()).toBeUndefined();
  });

  it('steps forward along the main line and back', () => {
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: r.nav.forward }));
    fireEvent.click(screen.getByRole('button', { name: r.nav.forward }));
    expect(current()).toBe('d5');
    fireEvent.click(screen.getByRole('button', { name: r.nav.back }));
    expect(current()).toBe('d4');
    expect(screen.getByText('Solid')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: r.nav.start }));
    expect(current()).toBeUndefined();
  });

  it('goes to a move played on the board when the chapter has it', () => {
    renderScreen();
    boardMove('d2', 'd4');
    expect(current()).toBe('d4');
    expect(ground.set).toHaveBeenLastCalledWith(
      expect.objectContaining({ lastMove: ['d2', 'd4'] }),
    );
  });

  it('says a move is not in the chapter and puts the piece back', () => {
    renderScreen();
    ground.set.mockClear();
    boardMove('e2', 'e4');
    expect(screen.getByText(r.board.notInRepertoire)).toBeDefined();
    expect(current()).toBeUndefined();
    expect(ground.set.mock.calls.map(([config]) => config.fen)).toContain(
      fenOf(START_KEY),
    );
  });

  it('plays a typed move, and says when it is not a legal one', () => {
    renderScreen();
    const field = screen.getByLabelText<HTMLInputElement>(
      lt.board.moveInput.label,
    );
    fireEvent.change(field, { target: { value: 'd4' } });
    fireEvent.submit(field);
    expect(current()).toBe('d4');
    expect(field.value).toBe('');
    fireEvent.change(field, { target: { value: 'Ke2' } });
    fireEvent.submit(field);
    expect(screen.getByText(lt.board.moveInput.unknown)).toBeDefined();
    expect(field.value).toBe('Ke2');
  });

  it('opens another chapter at its root', () => {
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: /1 skyrius iš 2/ }));
    const second = screen
      .getAllByRole('button')
      .find(
        (b) =>
          b.getAttribute('aria-current') === null && b.closest('ul') !== null,
      );
    if (second === undefined) throw new Error('no second chapter');
    fireEvent.click(second);
    expect(
      screen.getByRole('button', { name: /2 skyrius iš 2/ }),
    ).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: r.nav.forward }));
    fireEvent.click(screen.getByRole('button', { name: r.nav.forward }));
    expect(current()).toBe('Nf6');
  });

  it('asks which piece a pawn becomes, then goes to that move', () => {
    const root = '8/1P6/8/8/8/8/8/k6K w - -';
    const base: RepertoireGraph = {
      side: 'white',
      chapters: [
        {
          id: 'c1',
          rootKey: root,
          intro: null,
          nameSource: { kind: 'custom', name: 'Pėstininkas' },
        },
      ],
      moves: [],
    };
    const added = addMove(base, 'c1', root, 'b8=Q');
    if (!added.ok) throw new Error('no move');
    renderScreen(added.value);
    boardMove('b7', 'b8');
    fireEvent.click(screen.getByRole('button', { name: lt.board.promotion.q }));
    expect(current()).toBe('b8=Q');
  });

  it('saves a personal note on the current move and keeps it', async () => {
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: r.nav.forward }));
    fireEvent.change(screen.getByLabelText(r.note.label), {
      target: { value: 'Mano planas' },
    });
    fireEvent.click(screen.getByRole('button', { name: r.note.save }));
    await screen.findByText(r.note.saved);
    expect(server.saveNote).toHaveBeenCalledWith({
      repertoireId: ID,
      moveKey: moveKey(START_KEY, 'd4'),
      text: 'Mano planas',
    });
    fireEvent.click(screen.getByRole('button', { name: r.nav.forward }));
    fireEvent.click(screen.getByRole('button', { name: r.nav.back }));
    expect(screen.getByLabelText<HTMLTextAreaElement>(r.note.label).value).toBe(
      'Mano planas',
    );
    expect(
      screen.getByRole('button', {
        name: /1\. d4, yra komentaras, yra mano užrašas/,
      }),
    ).toBeDefined();
  });
});

describe('RepertoireScreen: an empty repertoire', () => {
  it('invites the first move or a PGN, with no chapters to choose', async () => {
    renderScreen({ side: 'black', chapters: [], moves: [] }, 'Taimanovas');
    expect(screen.getByText(r.panel.emptyBuild)).toBeDefined();
    expect(
      screen
        .getByRole('link', { name: r.panel.addFromPgn })
        .getAttribute('href'),
    ).toBe(`/repertuarai/importuoti?i=${ID}`);
    expect(
      screen.getByRole('application', { name: 'Šachmatų lenta, Taimanovas' }),
    ).toBeDefined();
    expect(screen.queryByRole('button', { name: /skyrius iš/ })).toBeNull();
    await waitFor(() => {
      expect(ground.created.at(-1)?.orientation).toBe('black');
    });
  });
});
