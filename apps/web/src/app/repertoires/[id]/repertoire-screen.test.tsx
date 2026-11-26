import type { Config } from '@lichess-org/chessground/config';
import type { Key } from '@lichess-org/chessground/types';
import {
  addChapter,
  addMove,
  editComment,
  fenOf,
  moveKey,
  removeMove,
  setMarks,
  START_KEY,
  type RepertoireGraph,
} from '@mychess/chess';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { graphOf, LONDON } from '../../../../test/fixtures/repertoires';
import { MESSAGES } from '../../../i18n/catalogue';
import {
  chapterNamesOf,
  plainChapterTitle,
} from '../../../server/chapter-names';
import type { NoteOutcome } from '../../repertoire-view';
import { panelTraining } from '../../repertoire-view/test-training';
import type { EditOutcome } from './actions';
import {
  RepertoireScreen,
  type RepertoireScreenProps,
} from './repertoire-screen';

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
  edit: vi.fn<(input: unknown) => Promise<EditOutcome>>(),
  refresh: vi.fn<() => void>(),
}));

vi.mock('./actions', () => ({
  savePersonalNoteAction: server.saveNote,
  editRepertoireAction: server.edit,
  renameRepertoireAction: vi.fn(),
  deleteRepertoireAction: vi.fn(),
}));

vi.mock('./sharing-actions', () => ({ setSharesAction: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: server.refresh }),
}));

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a value');
  return value;
}

const ID = '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10';
const GRAPH = graphOf(LONDON);
const r = MESSAGES.repertoires;

/** The owner's training: 4 due, 9 to learn today, 64% learned. */
const TRAINING = panelTraining({
  repertoireId: ID,
  counts: { due: 4, toLearn: 9 },
  standing: {
    counts: { notStarted: 5, skipped: 0, due: 4, learned: 16 },
    mastered: false,
  },
});

type Coaching = Partial<
  Pick<RepertoireScreenProps, 'coachNotes' | 'forkNotes' | 'training'>
>;

function renderScreen(
  graph: RepertoireGraph = GRAPH,
  name = 'Londono sistema',
  coaching: Coaching = {},
) {
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      <RepertoireScreen
        repertoire={{ id: ID, name, side: graph.side, version: 3 }}
        graph={graph}
        notes={{}}
        names={chapterNamesOf(graph)}
        coachNotes={coaching.coachNotes ?? []}
        forkNotes={coaching.forkNotes ?? []}
        training={coaching.training ?? null}
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
  server.edit.mockReset();
});

describe('RepertoireScreen: browsing', () => {
  it('names the board after the repertoire and the chapter', () => {
    renderScreen();
    const title = plainChapterTitle(GRAPH);
    // The chapters are named in English (R-180), where the two London
    // chapters' openings differ, so neither is told apart (R-158).
    expect(title(must(GRAPH.chapters[1]))).not.toBe(
      title(must(GRAPH.chapters[0])),
    );
    expect(
      screen.getByRole('application', {
        name: `Chess board, Londono sistema, ${title(must(GRAPH.chapters[0]))}`,
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

  it('shows the coaches’ notes on the current move only (R-107)', () => {
    renderScreen(GRAPH, 'Londono sistema', {
      coachNotes: [
        {
          coachId: 'c-1',
          coachName: 'Rimantas',
          moveKey: moveKey(START_KEY, 'd4'),
          text: 'Pirmiausia Bf4',
        },
      ],
    });
    expect(screen.queryByText('Pirmiausia Bf4')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: r.nav.forward }));
    expect(
      screen.getByRole('list', { name: MESSAGES.coachNote.list }).textContent,
    ).toBe('Coach note from RimantasPirmiausia Bf4');
    fireEvent.click(screen.getByRole('button', { name: r.nav.forward }));
    expect(screen.queryByText('Pirmiausia Bf4')).toBeNull();
  });

  it('shows the notes a fork kept from its coach, read-only, before any sharing coach’s (R-43, R-47)', () => {
    renderScreen(GRAPH, 'Londono sistema', {
      forkNotes: [
        {
          moveKey: moveKey(START_KEY, 'd4'),
          text: 'Visada Bf4',
          coachName: 'Jonas',
        },
      ],
      coachNotes: [
        {
          coachId: 'c-1',
          coachName: 'Rimantas',
          moveKey: moveKey(START_KEY, 'd4'),
          text: 'Pirmiausia Bf4',
        },
      ],
    });
    fireEvent.click(screen.getByRole('button', { name: r.nav.forward }));
    const notes = screen.getByRole('list', { name: MESSAGES.coachNote.list });
    expect(
      [...notes.querySelectorAll('li')].map((li) => li.textContent),
    ).toEqual([
      'Coach note from JonasVisada Bf4',
      'Coach note from RimantasPirmiausia Bf4',
    ]);
    expect(notes.querySelector('textarea')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: r.nav.forward }));
    expect(screen.queryByText('Visada Bf4')).toBeNull();
    // The move list marks the kept note with a pen; a sharing coach's
    // note is not marked on the owner's list.
    expect(
      screen
        .getByRole('button', {
          name: `1. d4, ${r.moves.hasComment}, ${r.moves.hasKeptCoachNote}`,
        })
        .querySelector('[data-note="kept"]'),
    ).not.toBeNull();
  });

  it('leads back to Repertoires and to its Repertoire screen, with none of its actions on the page (R-226)', () => {
    renderScreen();
    expect(
      screen
        .getByRole('link', { name: 'Back to Repertoires' })
        .getAttribute('href'),
    ).toBe('/repertoires');
    expect(
      screen.getByRole('link', { name: r.more }).getAttribute('href'),
    ).toBe(`/repertoires/${ID}/manage`);
    for (const name of [r.header.rename, r.header.delete])
      expect(screen.queryByRole('button', { name })).toBeNull();
    expect(screen.queryByRole('link', { name: r.header.download })).toBeNull();
    expect(
      screen.queryByRole('heading', { name: MESSAGES.share.title }),
    ).toBeNull();
  });

  it('sums it up under the name, with Review and Learn today (spec, Header)', () => {
    renderScreen(GRAPH, 'Londono sistema', {
      training: TRAINING,
    });
    expect(screen.getByText('White · 2 chapters · 64% learned')).toBeDefined();
    expect(
      screen.getByRole('link', { name: 'Review 4' }).getAttribute('href'),
    ).toBe(`/training?mode=review&r=${ID}`);
    expect(
      screen.getByRole('link', { name: 'Learn 9 today' }).getAttribute('href'),
    ).toBe(`/training?mode=learn&r=${ID}`);
    // The builder shows no progress (spec, Builder).
    fireEvent.click(screen.getByRole('switch', { name: r.mode.build }));
    expect(screen.getByText('White · 2 chapters')).toBeDefined();
    expect(screen.queryByRole('link', { name: 'Review 4' })).toBeNull();
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
      MESSAGES.board.moveInput.label,
    );
    fireEvent.change(field, { target: { value: 'd4' } });
    fireEvent.submit(field);
    expect(current()).toBe('d4');
    expect(field.value).toBe('');
    fireEvent.change(field, { target: { value: 'Ke2' } });
    fireEvent.submit(field);
    expect(screen.getByText(MESSAGES.board.moveInput.unknown)).toBeDefined();
    expect(field.value).toBe('Ke2');
  });

  it('opens another chapter at its root', () => {
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: /Chapter 1 of 2/ }));
    const second = screen
      .getAllByRole('button')
      .find(
        (b) =>
          b.getAttribute('aria-current') === null && b.closest('ul') !== null,
      );
    if (second === undefined) throw new Error('no second chapter');
    fireEvent.click(second);
    expect(
      screen.getByRole('button', { name: /Chapter 2 of 2/ }),
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
    fireEvent.click(
      screen.getByRole('button', { name: MESSAGES.board.promotion.q }),
    );
    expect(current()).toBe('b8=Q');
  });

  it('saves a personal note on the current move and keeps it', async () => {
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: r.nav.forward }));
    fireEvent.click(screen.getByRole('button', { name: r.note.label }));
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
        name: /1\. d4, has a comment, has my note/,
      }),
    ).toBeDefined();
  });
});

describe('RepertoireScreen: an empty repertoire', () => {
  it('invites the first move or a PGN, with no chapters to choose', async () => {
    renderScreen({ side: 'black', chapters: [], moves: [] }, 'Taimanovas');
    const empty = screen.getByText(r.panel.emptyBuild).parentElement;
    if (empty === null) throw new Error('no empty state');
    // The same words as the header's "Add from PGN": one action, one name.
    expect(
      within(empty)
        .getByRole('link', { name: r.header.importInto })
        .getAttribute('href'),
    ).toBe(`/repertoires/import?i=${ID}`);
    expect(
      screen.getByRole('application', { name: 'Chess board, Taimanovas' }),
    ).toBeDefined();
    expect(
      screen.queryByRole('button', { name: /Chapter [0-9]+ of/ }),
    ).toBeNull();
    await waitFor(() => {
      expect(ground.created.at(-1)?.orientation).toBe('black');
    });
  });
});

/** What the action answers for an edit that `result` decided. */
function savedAs(
  result: { ok: true; value: RepertoireGraph } | { ok: false },
  version = 4,
): EditOutcome {
  if (!result.ok) throw new Error('refused');
  return {
    ok: true,
    graph: result.value,
    version,
    names: chapterNamesOf(result.value),
  };
}

const b = r.builder;
const modeSwitch = () => screen.getByRole('switch', { name: r.mode.build });
const named = (name: string | RegExp) => screen.getByRole('button', { name });

function building(graph: RepertoireGraph = GRAPH): void {
  renderScreen(graph);
  if (modeSwitch().getAttribute('aria-checked') === 'false')
    fireEvent.click(modeSwitch());
}

/** A press on the (mocked) board, as chessground reports it. */
function press(square: Key): void {
  act(() => {
    ground.created.at(-1)?.events?.select?.(square);
  });
}

describe('RepertoireScreen: builder mode', () => {
  it('switches between browsing and building', () => {
    renderScreen();
    expect(modeSwitch().getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByRole('button', { name: b.draw })).toBeNull();
    fireEvent.click(modeSwitch());
    expect(modeSwitch().getAttribute('aria-checked')).toBe('true');
    expect(named(b.draw)).toBeDefined();
  });

  it('saves a move the chapter does not have, from the current position', async () => {
    const afterD4 = must(GRAPH.moves[0]).to;
    server.edit.mockResolvedValue(savedAs(addMove(GRAPH, 'c1', afterD4, 'e5')));
    building();
    fireEvent.click(named(r.nav.forward));
    ground.set.mockClear();
    boardMove('e7', 'e5');
    expect(server.edit).toHaveBeenCalledWith({
      repertoireId: ID,
      version: 3,
      op: { kind: 'addMove', chapterId: 'c1', from: afterD4, san: 'e5' },
    });
    expect(ground.set.mock.calls.map(([config]) => config.fen)).not.toContain(
      fenOf(afterD4),
    );
    await waitFor(() => {
      expect(current()).toBe('e5');
    });
  });

  it('goes to a move the chapter already has without saving', () => {
    building();
    boardMove('d2', 'd4');
    expect(current()).toBe('d4');
    expect(server.edit).not.toHaveBeenCalled();
  });

  it('shows a refusal in words and puts the piece back', async () => {
    server.edit.mockResolvedValue({
      ok: false,
      refusal: 'repertoire.secondAnswer',
    });
    building();
    ground.set.mockClear();
    boardMove('e2', 'e4');
    expect(
      await screen.findByText(MESSAGES.repertoire.secondAnswer),
    ).toBeDefined();
    // The snap-back is the board's passive effect on the reset revision: it
    // runs after the commit that shows the refusal, so it is waited for.
    await waitFor(() => {
      expect(ground.set.mock.calls.map(([config]) => config.fen)).toContain(
        fenOf(START_KEY),
      );
    });
    expect(current()).toBeUndefined();
  });

  it('says the move limit with its number and puts the piece back (R-162)', async () => {
    server.edit.mockResolvedValue({
      ok: false,
      refusal: 'repertoire.tooManyMoves',
      limit: 5000,
    });
    building();
    ground.set.mockClear();
    boardMove('e2', 'e4');
    expect(
      await screen.findByText(/^A repertoire can hold up to 5,000 moves\.$/),
    ).toBeDefined();
    await waitFor(() => {
      expect(ground.set.mock.calls.map(([config]) => config.fen)).toContain(
        fenOf(START_KEY),
      );
    });
  });

  it('offers Reload and stops editing when the repertoire changed elsewhere', async () => {
    server.edit.mockResolvedValue({ ok: false, refusal: 'repertoire.stale' });
    building();
    boardMove('e2', 'e4');
    expect(
      await screen.findByRole('button', { name: r.stale.reload }),
    ).toBeDefined();
    fireEvent.click(named(r.nav.forward));
    expect(named(b.remove)).toHaveProperty('disabled', true);
  });

  it('removes the current move after the confirmation and says so', async () => {
    server.edit.mockResolvedValue(
      savedAs(removeMove(GRAPH, 'c1', START_KEY, 'd4')),
    );
    building();
    fireEvent.click(named(r.nav.forward));
    fireEvent.click(named(b.remove));
    expect(screen.getByText(/Remove 1\. d4 and the 8/)).toBeDefined();
    fireEvent.click(named(b.removeSubmit));
    expect(server.edit).toHaveBeenCalledWith({
      repertoireId: ID,
      version: 3,
      op: { kind: 'removeMove', chapterId: 'c1', from: START_KEY, san: 'd4' },
    });
    expect(await screen.findByText(b.removeDone)).toBeDefined();
    expect(current()).toBeUndefined();
  });

  it('draws an arrow by tapping two squares in draw mode, marking the first', async () => {
    const marks = {
      arrows: [
        { from: 'c1', to: 'f4', color: 'G' },
        { from: 'e2', to: 'e4', color: 'R' },
      ],
      circles: [],
    } as const;
    server.edit.mockResolvedValue(
      savedAs(setMarks(GRAPH, 'c1', { from: START_KEY, san: 'd4' }, marks)),
    );
    building();
    fireEvent.click(named(r.nav.forward));
    fireEvent.click(named(b.draw));
    fireEvent.click(named(r.colors.R));
    press('e2');
    expect(ground.set).toHaveBeenLastCalledWith({
      highlight: { custom: new Map([['e2', 'selected']]) },
    });
    expect(screen.getByText('From e2')).toBeDefined();
    press('e4');
    expect(server.edit).toHaveBeenCalledWith({
      repertoireId: ID,
      version: 3,
      op: {
        kind: 'setMarks',
        chapterId: 'c1',
        from: START_KEY,
        san: 'd4',
        marks,
      },
    });
    expect(await screen.findByText('Arrow e2 to e4, red, added')).toBeDefined();
  });

  it('takes no board move in draw mode, and Done leaves it', () => {
    building();
    fireEvent.click(named(r.nav.forward));
    fireEvent.click(named(b.draw));
    const picking = ground.set.mock.calls
      .map(([config]) => config)
      .filter((config) => config.draggable?.enabled === false)
      .at(-1);
    expect(picking?.movable?.dests).toEqual(new Map());
    expect(picking?.selectable).toEqual({ enabled: false });
    fireEvent.click(named(b.drawDone));
    expect(named(b.draw)).toBeDefined();
  });

  it('saves the comment through the action', async () => {
    server.edit.mockResolvedValue(
      savedAs(editComment(GRAPH, moveKey(START_KEY, 'd4'), 'Tvirta')),
    );
    building();
    fireEvent.click(named(r.nav.forward));
    fireEvent.change(screen.getByRole('textbox', { name: b.commentLabel }), {
      target: { value: 'Tvirta' },
    });
    fireEvent.click(named(b.commentSave));
    expect(await screen.findByText(b.commentSaved)).toBeDefined();
    expect(server.edit).toHaveBeenCalledWith({
      repertoireId: ID,
      version: 3,
      op: {
        kind: 'editComment',
        moveKey: moveKey(START_KEY, 'd4'),
        comment: 'Tvirta',
      },
    });
  });

  it('adds a chapter and opens it', async () => {
    server.edit.mockResolvedValue({
      ok: true,
      graph: addChapter(GRAPH, START_KEY).graph,
      version: 4,
      names: chapterNamesOf(GRAPH),
    });
    building();
    fireEvent.click(named(/Chapter 1 of 2/));
    fireEvent.click(named(r.chapters.add));
    expect(server.edit).toHaveBeenCalledWith({
      repertoireId: ID,
      version: 3,
      op: { kind: 'addChapter' },
    });
    expect(
      await screen.findByRole('button', { name: /Chapter 3 of 3/ }),
    ).toBeDefined();
    expect(screen.getByText(b.playFirst)).toBeDefined();
  });
});

describe('RepertoireScreen: the first move of an empty repertoire (R-111)', () => {
  it('starts chapter one with the first move, in one save', async () => {
    const empty: RepertoireGraph = { side: 'white', chapters: [], moves: [] };
    const started = addChapter(empty, START_KEY).graph;
    server.edit.mockResolvedValue(
      savedAs(addMove(started, 'c1', START_KEY, 'd4'), 2),
    );
    renderScreen(empty, 'Naujas');
    expect(modeSwitch().getAttribute('aria-checked')).toBe('true');
    boardMove('d2', 'd4');
    expect(server.edit).toHaveBeenCalledTimes(1);
    expect(server.edit).toHaveBeenCalledWith({
      repertoireId: ID,
      version: 3,
      op: { kind: 'addMove', chapterId: null, from: START_KEY, san: 'd4' },
    });
    expect(
      await screen.findByRole('button', { name: /Chapter 1 of 1/ }),
    ).toBeDefined();
    expect(current()).toBe('d4');
  });

  it('offers the builder from browse mode', () => {
    renderScreen({ side: 'white', chapters: [], moves: [] }, 'Naujas');
    fireEvent.click(modeSwitch());
    expect(screen.getByText(r.panel.emptyBrowse)).toBeDefined();
    fireEvent.click(named(r.mode.toBuild));
    expect(modeSwitch().getAttribute('aria-checked')).toBe('true');
  });
});
