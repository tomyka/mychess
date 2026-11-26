import {
  addChapter,
  addMove,
  moveKey,
  removeChapter,
  removeMove,
  START_KEY,
  type RepertoireGraph,
} from '@mychess/chess';
import { REPERTOIRE_ISSUES } from '@mychess/domain';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { JSX } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { graphOf, LONDON } from '../../../test/fixtures/repertoires';
import { MESSAGES } from '../../i18n/catalogue';
import type { ChapterNames } from '../../lib/chapter-label';
import type { BuilderSave, BuilderSaved } from './builder-edit';
import { SAVING } from './screen-state';
import {
  useRepertoireBuilder,
  type RepertoireBuilder,
} from './use-repertoire-builder';

const GRAPH = graphOf(LONDON);
const AFTER_D4 = GRAPH.moves[0]?.to ?? '';
const NAMES: ChapterNames = { taxonomyNames: {}, distinctions: {} };
const SAVED_NAMES: ChapterNames = {
  taxonomyNames: { c1: 'London System' },
  distinctions: {},
};
const b = MESSAGES.repertoires.builder;

type Result = { ok: true; value: RepertoireGraph } | { ok: false };

/** A save that went through with the graph the chess edit gives. */
function savedAs(result: Result, version = 4): BuilderSaved {
  if (!result.ok) throw new Error('refused');
  return { ok: true, graph: result.value, version, names: SAVED_NAMES };
}

/**
 * Renders the builder on `graph` (version 3) with the fake `save`, showing
 * its builder row; returns the builder as of the last render.
 */
function renderBuilder(
  save: BuilderSave,
  graph: RepertoireGraph = GRAPH,
): () => RepertoireBuilder {
  let latest: RepertoireBuilder | undefined;
  function Probe(): JSX.Element {
    const builder = useRepertoireBuilder({
      graph,
      version: 3,
      side: graph.side,
      names: NAMES,
      save,
    });
    latest = builder;
    return <>{builder.toolbar}</>;
  }
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      <Probe />
    </NextIntlClientProvider>,
  );
  return () => {
    if (latest === undefined) throw new Error('not rendered');
    return latest;
  };
}

/** The builder in builder mode, on `graph`'s first chapter after `steps` moves. */
function building(
  save: BuilderSave,
  steps = 0,
  graph: RepertoireGraph = GRAPH,
): () => RepertoireBuilder {
  const builder = renderBuilder(save, graph);
  act(() => {
    builder().setBuilding(true);
  });
  for (let i = 0; i < steps; i += 1)
    act(() => {
      builder().view.dispatch({ type: 'forward' });
    });
  return builder;
}

const fakeSave = (outcome: BuilderSaved | Promise<BuilderSaved>) =>
  vi.fn<BuilderSave>(() => Promise.resolve(outcome));

const sanPath = (builder: RepertoireBuilder) =>
  builder.view.state.path.map((m) => m.san);

afterEach(() => {
  vi.useRealTimers();
});

describe('useRepertoireBuilder: browsing', () => {
  it('opens browsing, with no builder row or fields', () => {
    const builder = renderBuilder(vi.fn<BuilderSave>());
    expect(builder().building).toBe(false);
    expect(builder().toolbar).toBeNull();
    expect(builder().panel).toEqual({});
  });

  it('says a move the chapter lacks is not in it, without saving', () => {
    const save = vi.fn<BuilderSave>();
    const builder = renderBuilder(save);
    act(() => {
      builder().view.play.onTyped('e4');
    });
    expect(save).not.toHaveBeenCalled();
    expect(builder().view.state.message?.key).toBe(
      'repertoires.board.notInRepertoire',
    );
  });

  it('opens building in a repertoire without chapters (R-111)', () => {
    const empty: RepertoireGraph = { side: 'white', chapters: [], moves: [] };
    expect(renderBuilder(vi.fn<BuilderSave>(), empty)().building).toBe(true);
  });

  it('leaves builder mode, taking its row and fields with it', () => {
    const builder = building(vi.fn<BuilderSave>(), 1);
    expect(builder().panel.comment?.editor).toBeDefined();
    act(() => {
      builder().setBuilding(false);
    });
    expect(builder().building).toBe(false);
    expect(builder().panel).toEqual({});
    expect(screen.queryByRole('button', { name: b.draw })).toBeNull();
  });
});

describe('useRepertoireBuilder: adding a move', () => {
  it('saves a move the chapter lacks with its version and goes on to it', async () => {
    const save = fakeSave(savedAs(addMove(GRAPH, 'c1', AFTER_D4, 'e5')));
    const builder = building(save, 1);
    act(() => {
      builder().view.play.onTyped('e5');
    });
    expect(save).toHaveBeenCalledWith({
      version: 3,
      op: { kind: 'addMove', chapterId: 'c1', from: AFTER_D4, san: 'e5' },
    });
    await waitFor(() => {
      expect(sanPath(builder())).toEqual(['d4', 'e5']);
    });
    expect(builder().view.state.version).toBe(4);
    expect(builder().names).toBe(SAVED_NAMES);
  });

  it('sends the next edit with the version the last save gave', async () => {
    const save = fakeSave(savedAs(addMove(GRAPH, 'c1', AFTER_D4, 'e5'), 7));
    const builder = building(save, 1);
    act(() => {
      builder().view.play.onTyped('e5');
    });
    await waitFor(() => {
      expect(builder().view.state.version).toBe(7);
    });
    act(() => {
      builder().view.play.onTyped('Nf3');
    });
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({ version: 7 }),
    );
  });

  it('goes to a move the chapter has without saving', () => {
    const save = vi.fn<BuilderSave>();
    const builder = building(save);
    act(() => {
      builder().view.play.onTyped('d4');
    });
    expect(save).not.toHaveBeenCalled();
    expect(sanPath(builder())).toEqual(['d4']);
  });

  it('says "Saving" when a save takes a second', async () => {
    vi.useFakeTimers();
    const builder = building(
      vi.fn<BuilderSave>(() => new Promise<BuilderSaved>(() => undefined)),
      1,
    );
    act(() => {
      builder().view.play.onTyped('e5');
    });
    expect(builder().view.state.saving).toBe(true);
    expect(builder().view.state.message).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(builder().view.state.message).toEqual({
      key: SAVING,
      tone: 'info',
    });
  });
});

describe('useRepertoireBuilder: a refused save', () => {
  it('says the refusal and puts the pieces back', async () => {
    const builder = building(
      fakeSave({ ok: false, refusal: 'repertoire.secondAnswer' }),
    );
    const revision = builder().view.state.revision;
    act(() => {
      builder().view.play.onTyped('e4');
    });
    await waitFor(() => {
      expect(builder().view.state.message).toEqual({
        key: 'repertoire.secondAnswer',
        tone: 'error',
      });
    });
    expect(builder().view.state.revision).toBe(revision + 1);
    expect(builder().view.state.saving).toBe(false);
    expect(sanPath(builder())).toEqual([]);
  });

  it('says the limit a refusal names (R-162)', async () => {
    const builder = building(
      fakeSave({ ok: false, refusal: 'repertoire.tooManyMoves', limit: 5000 }),
    );
    act(() => {
      builder().view.play.onTyped('e4');
    });
    await waitFor(() => {
      expect(builder().view.state.message?.values).toEqual({ limit: 5000 });
    });
  });

  it('says a save that failed to reach the server failed', async () => {
    const builder = building(
      vi.fn<BuilderSave>(() => Promise.reject(new Error('offline'))),
    );
    act(() => {
      builder().view.play.onTyped('e4');
    });
    await waitFor(() => {
      expect(builder().view.state.message?.key).toBe('repertoires.failed');
    });
  });

  it('stops editing once the repertoire changed elsewhere', async () => {
    const builder = building(
      fakeSave({ ok: false, refusal: 'repertoire.stale' }),
      1,
    );
    act(() => {
      builder().view.play.onTyped('e5');
    });
    await waitFor(() => {
      expect(builder().view.state.stale).toBe(true);
    });
    expect(builder().panel.comment?.editor?.disabled).toBe(true);
    expect(builder().panel.chapterBuilder?.disabled).toBe(true);
    expect(
      screen.getByRole('button', { name: b.remove }).hasAttribute('disabled'),
    ).toBe(true);
  });
});

describe('useRepertoireBuilder: the comment field', () => {
  it('has none at a chapter root', () => {
    expect(
      building(vi.fn<BuilderSave>())().panel.comment?.editor,
    ).toBeUndefined();
  });

  it('saves the current move’s comment', async () => {
    const save = fakeSave(savedAs({ ok: true, value: GRAPH }));
    const editor = building(save, 1)().panel.comment?.editor;
    let outcome: unknown;
    await act(async () => {
      outcome = await editor?.onSave('Tvirta');
    });
    expect(outcome).toEqual({ ok: true });
    expect(save).toHaveBeenCalledWith({
      version: 3,
      op: {
        kind: 'editComment',
        moveKey: moveKey(START_KEY, 'd4'),
        comment: 'Tvirta',
      },
    });
  });

  it('leaves its own refusal to the field, the status line untouched', async () => {
    const refusal = REPERTOIRE_ISSUES.commentTooLong;
    const builder = building(fakeSave({ ok: false, refusal }), 1);
    let outcome: unknown;
    await act(async () => {
      outcome = await builder().panel.comment?.editor?.onSave('x');
    });
    expect(outcome).toEqual({ ok: false, refusal });
    expect(builder().view.state.message).toBeNull();
    expect(builder().view.state.saving).toBe(false);
  });

  it('shows a stale refusal on the whole screen', async () => {
    const builder = building(
      fakeSave({ ok: false, refusal: 'repertoire.stale' }),
      1,
    );
    await act(async () => {
      await builder().panel.comment?.editor?.onSave('x');
    });
    expect(builder().view.state.stale).toBe(true);
    expect(builder().view.state.message?.key).toBe('repertoire.stale');
  });
});

describe('useRepertoireBuilder: chapters', () => {
  it('adds a chapter and opens it at its root', async () => {
    const added = addChapter(GRAPH, START_KEY);
    const builder = building(
      fakeSave(savedAs({ ok: true, value: added.graph })),
      1,
    );
    act(() => {
      builder().panel.chapterBuilder?.onAdd();
    });
    await waitFor(() => {
      expect(builder().view.state.chapterId).toBe(added.chapterId);
    });
    expect(sanPath(builder())).toEqual([]);
  });

  it('renames a chapter, and leaves a refused name to its field', async () => {
    const save = fakeSave({
      ok: false,
      refusal: REPERTOIRE_ISSUES.chapterNameBlank,
    });
    const builder = building(save);
    let outcome: unknown;
    await act(async () => {
      outcome = await builder().panel.chapterBuilder?.onRename('c2', ' ');
    });
    expect(save).toHaveBeenCalledWith({
      version: 3,
      op: { kind: 'renameChapter', chapterId: 'c2', name: ' ' },
    });
    expect(outcome).toEqual({
      ok: false,
      refusal: REPERTOIRE_ISSUES.chapterNameBlank,
    });
    expect(builder().view.state.message).toBeNull();
  });

  /** Deletes `chapterId` while on c1 (at d4); where the screen goes after. */
  async function afterDelete(
    chapterId: string,
    after: RepertoireGraph,
  ): Promise<{ chapterId: string | null; path: string[] }> {
    const save = fakeSave(savedAs({ ok: true, value: after }));
    const builder = building(save, 1);
    act(() => {
      builder().panel.chapterBuilder?.onDelete(chapterId);
    });
    expect(save).toHaveBeenCalledWith({
      version: 3,
      op: { kind: 'removeChapter', chapterId },
    });
    await waitFor(() => {
      expect(builder().view.state.saving).toBe(false);
    });
    return {
      chapterId: builder().view.state.chapterId,
      path: sanPath(builder()),
    };
  }

  it('opens the first chapter left at its root when the open one goes', async () => {
    const after = removeChapter(GRAPH, 'c1');
    if (!after.ok) throw new Error('refused');
    expect(await afterDelete('c1', after.value)).toEqual({
      chapterId: 'c2',
      path: [],
    });
  });

  it('opens no chapter when the open one was the last', async () => {
    expect(await afterDelete('c1', { ...GRAPH, chapters: [] })).toEqual({
      chapterId: null,
      path: [],
    });
  });

  it('stays where it is when another chapter goes', async () => {
    const after = removeChapter(GRAPH, 'c2');
    if (!after.ok) throw new Error('refused');
    expect(await afterDelete('c2', after.value)).toEqual({
      chapterId: 'c1',
      path: ['d4'],
    });
  });
});

describe('useRepertoireBuilder: the builder row', () => {
  it('has no row without a chapter', () => {
    const empty: RepertoireGraph = { side: 'white', chapters: [], moves: [] };
    renderBuilder(vi.fn<BuilderSave>(), empty);
    expect(screen.queryByRole('button', { name: b.draw })).toBeNull();
  });

  it('removes the current move after the confirmation, then says so', async () => {
    const save = fakeSave(savedAs(removeMove(GRAPH, 'c1', START_KEY, 'd4')));
    const builder = building(save, 1);
    fireEvent.click(screen.getByRole('button', { name: b.remove }));
    expect(screen.getByText(/^Remove 1\. d4 and the 8 /)).toBeDefined();
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: b.removeSubmit }));
    expect(save).toHaveBeenCalledWith({
      version: 3,
      op: { kind: 'removeMove', chapterId: 'c1', from: START_KEY, san: 'd4' },
    });
    await waitFor(() => {
      expect(builder().view.state.message).toEqual({
        key: 'repertoires.builder.removeDone',
        tone: 'success',
      });
    });
    expect(sanPath(builder())).toEqual([]);
  });

  it('turns draw mode on and picks its colour', () => {
    const builder = building(vi.fn<BuilderSave>(), 1);
    fireEvent.click(screen.getByRole('button', { name: b.draw }));
    expect(builder().view.state.drawMode).toBe(true);
    fireEvent.click(
      screen.getByRole('button', { name: MESSAGES.repertoires.colors.R }),
    );
    expect(builder().view.state.drawColor).toBe('R');
  });
});

describe('useRepertoireBuilder: drawing', () => {
  /** In draw mode on 1. d4 (which has a green c1-f4 arrow). */
  function drawing(save: BuilderSave = vi.fn<BuilderSave>()) {
    const builder = building(save, 1);
    act(() => {
      builder().view.dispatch({ type: 'draw', on: true });
    });
    return builder;
  }

  it('toggles an arrow with two taps and saves it at once', () => {
    const save = vi.fn<BuilderSave>(
      () => new Promise<BuilderSaved>(() => undefined),
    );
    const builder = drawing(save);
    act(() => {
      builder().drawing.onSquare('e2');
    });
    expect(builder().view.state.drawFrom).toBe('e2');
    expect(builder().drawing.said).toBe('From e2');
    act(() => {
      builder().drawing.onSquare('e4');
    });
    expect(save).toHaveBeenCalledWith({
      version: 3,
      op: {
        kind: 'setMarks',
        chapterId: 'c1',
        from: START_KEY,
        san: 'd4',
        marks: {
          arrows: [
            { from: 'c1', to: 'f4', color: 'G' },
            { from: 'e2', to: 'e4', color: 'G' },
          ],
          circles: [],
        },
      },
    });
    expect(builder().drawing.said).toBe('Arrow e2 to e4, green, added');
    expect(builder().view.state.drawFrom).toBeNull();
  });

  it('saves the shapes drawn with the mouse', () => {
    const save = vi.fn<BuilderSave>(
      () => new Promise<BuilderSaved>(() => undefined),
    );
    const builder = building(save, 1);
    act(() => {
      builder().drawing.onShapes([{ orig: 'd4', brush: 'red' }]);
    });
    expect(save).toHaveBeenCalledWith({
      version: 3,
      op: {
        kind: 'setMarks',
        chapterId: 'c1',
        from: START_KEY,
        san: 'd4',
        marks: { arrows: [], circles: [{ square: 'd4', color: 'R' }] },
      },
    });
  });

  it('draws nothing while browsing', () => {
    const save = vi.fn<BuilderSave>();
    const builder = renderBuilder(save);
    act(() => {
      builder().view.dispatch({ type: 'forward' });
    });
    act(() => {
      builder().drawing.onShapes([{ orig: 'd4', brush: 'red' }]);
      builder().drawing.onSquare('e2');
    });
    expect(save).not.toHaveBeenCalled();
    expect(builder().view.state.drawFrom).toBeNull();
  });

  it('Escape drops a first square, then leaves draw mode', () => {
    const builder = drawing();
    act(() => {
      builder().drawing.onSquare('e2');
    });
    act(() => {
      builder().drawing.onEscape();
    });
    expect(builder().view.state.drawFrom).toBeNull();
    expect(builder().view.state.drawMode).toBe(true);
    act(() => {
      builder().drawing.onEscape();
    });
    expect(builder().view.state.drawMode).toBe(false);
  });

  it('Escape does nothing outside draw mode', () => {
    const builder = building(vi.fn<BuilderSave>(), 1);
    const before = builder().view.state;
    act(() => {
      builder().drawing.onEscape();
    });
    expect(builder().view.state).toBe(before);
  });
});
