import { renderHook } from '@testing-library/react';
import type { RepertoireGraph } from '@mychess/chess';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { graphOf, LONDON } from '../../../../test/fixtures/repertoires';
import { MESSAGES } from '../../../i18n/catalogue';
import { chapterBuilder, useDrawing, type Edit } from './use-builder';

vi.mock('./actions', () => ({ editRepertoireAction: vi.fn() }));

type ScreenState = Parameters<typeof useDrawing>[0];

const GRAPH = graphOf(LONDON);

function stateOf(changes: Partial<ScreenState> = {}): ScreenState {
  return {
    graph: GRAPH,
    version: 1,
    chapterId: 'c1',
    path: [],
    mode: 'build',
    drawMode: false,
    drawColor: 'G',
    drawFrom: null,
    saving: false,
    stale: false,
    message: null,
    revision: 0,
    ...changes,
  };
}

function wrapper({ children }: { readonly children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      {children}
    </NextIntlClientProvider>
  );
}

/** Escape pressed in draw mode, with what it dispatched. */
function escape(state: ScreenState): unknown[] {
  const dispatch = vi.fn();
  const edit: Edit = vi.fn();
  const { result } = renderHook(() => useDrawing(state, dispatch, edit), {
    wrapper,
  });
  result.current.onEscape();
  return dispatch.mock.calls.map(([action]: unknown[]) => action);
}

describe('useDrawing onEscape', () => {
  it('drops a first tapped square, staying in draw mode', () => {
    expect(escape(stateOf({ drawMode: true, drawFrom: 'e2' }))).toEqual([
      { type: 'drawFrom', square: null },
    ]);
  });

  it('leaves draw mode when no square waits for a second', () => {
    expect(escape(stateOf({ drawMode: true }))).toEqual([
      { type: 'draw', on: false },
    ]);
  });

  it('does nothing outside draw mode', () => {
    expect(escape(stateOf())).toEqual([]);
  });
});

/** Deletes `chapterId` from a screen on `current`; where the screen goes after. */
function placeAfterDelete(
  current: string,
  chapterId: string,
  after: RepertoireGraph,
): unknown {
  const edit = vi.fn<Edit>(() => Promise.resolve({ ok: true }));
  chapterBuilder(stateOf({ chapterId: current }), edit)?.onDelete(chapterId);
  const [op, options] = edit.mock.calls[0] ?? [];
  expect(op).toEqual({ kind: 'removeChapter', chapterId });
  return options?.place?.(after);
}

describe('chapterBuilder onDelete place', () => {
  const [, second] = GRAPH.chapters;

  it('opens the first chapter left at its root when the open one goes', () => {
    const after = { ...GRAPH, chapters: GRAPH.chapters.slice(1) };
    expect(placeAfterDelete('c1', 'c1', after)).toEqual({
      chapterId: second?.id,
      path: [],
    });
  });

  it('opens no chapter when the open one was the last', () => {
    const after = { ...GRAPH, chapters: [] };
    expect(placeAfterDelete('c1', 'c1', after)).toEqual({
      chapterId: null,
      path: [],
    });
  });

  it('stays where it is when another chapter goes', () => {
    expect(placeAfterDelete('c1', 'c2', GRAPH)).toEqual({});
  });
});
