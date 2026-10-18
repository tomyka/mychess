import {
  chapterChildren,
  editComment,
  moveKey,
  removeMove,
  START_KEY,
  type RepertoireGraph,
  type RepertoireMove,
} from '@mychess/chess';
import { describe, expect, it } from 'vitest';
import { graphOf, LONDON } from '../../../../test/fixtures/repertoires';
import {
  currentKey,
  initialState,
  keepPath,
  screenReducer,
  type ScreenAction,
  type ScreenState,
} from './screen-state';

const GRAPH = graphOf(LONDON);

/** The moves of chapter `chapterId` played from its root, by SAN. */
function line(
  sans: readonly string[],
  graph: RepertoireGraph = GRAPH,
  chapterId = 'c1',
): RepertoireMove[] {
  const children = chapterChildren(graph)(chapterId);
  const moves: RepertoireMove[] = [];
  let key = START_KEY;
  for (const san of sans) {
    const move = children(key).find((m) => m.san === san);
    if (move === undefined) throw new Error(`no ${san}`);
    moves.push(move);
    key = move.to;
  }
  return moves;
}

const sansOf = (state: ScreenState): string[] => state.path.map((m) => m.san);

const run = (state: ScreenState, ...actions: ScreenAction[]): ScreenState =>
  actions.reduce(screenReducer, state);

const START = initialState(GRAPH, 4);

function edited(
  result: { ok: true; value: RepertoireGraph } | { ok: false },
): RepertoireGraph {
  if (!result.ok) throw new Error('refused');
  return result.value;
}

describe('initialState', () => {
  it('opens the first chapter at its root, browsing', () => {
    expect(START).toEqual({
      graph: GRAPH,
      version: 4,
      chapterId: 'c1',
      path: [],
      mode: 'browse',
      drawMode: false,
      drawColor: 'G',
      drawFrom: null,
      saving: false,
      stale: false,
      message: null,
      revision: 0,
    });
  });

  it('opens a repertoire without chapters in builder mode (decision 18)', () => {
    const empty = initialState({ side: 'black', chapters: [], moves: [] }, 1);
    expect(empty.mode).toBe('build');
    expect(empty.chapterId).toBeNull();
    expect(currentKey(empty)).toBeNull();
  });
});

describe('screenReducer: moving through a chapter', () => {
  it('goes to a path and back one move at a time', () => {
    const there = run(START, { type: 'goto', path: line(['d4', 'd5', 'Bf4']) });
    expect(sansOf(there)).toEqual(['d4', 'd5', 'Bf4']);
    expect(currentKey(there)).toBe(line(['d4', 'd5', 'Bf4'])[2]?.to);
    expect(sansOf(run(there, { type: 'back' }))).toEqual(['d4', 'd5']);
  });

  it('stays at the root on back', () => {
    expect(run(START, { type: 'back' })).toEqual(START);
    expect(currentKey(START)).toBe(START_KEY);
  });

  it('follows the main line forward: the first move added (R-79)', () => {
    expect(sansOf(run(START, { type: 'forward' }))).toEqual(['d4']);
    const atE3 = run(START, {
      type: 'goto',
      path: line(['d4', 'd5', 'Bf4', 'Nf6', 'e3']),
    });
    expect(sansOf(run(atE3, { type: 'forward' })).at(-1)).toBe('e6');
  });

  it('stays at the end of a line on forward', () => {
    const leaf = run(START, {
      type: 'goto',
      path: line(['d4', 'd5', 'Bf4', 'Nf6', 'e3', 'c5', 'c3']),
    });
    expect(run(leaf, { type: 'forward' })).toEqual(leaf);
  });

  it('opens another chapter at its root', () => {
    const there = run(
      START,
      { type: 'goto', path: line(['d4', 'd5']) },
      { type: 'chapter', chapterId: 'c2' },
    );
    expect(there.chapterId).toBe('c2');
    expect(there.path).toEqual([]);
    expect(
      sansOf(run(there, { type: 'forward' }, { type: 'forward' })),
    ).toEqual(['d4', 'Nf6']);
  });
});

describe('screenReducer: saves', () => {
  const atBf4 = run(START, { type: 'goto', path: line(['d4', 'd5', 'Bf4']) });

  it('keeps the path with the new moves, so a new comment shows', () => {
    const bf4 = line(['d4', 'd5', 'Bf4'])[2];
    const graph = edited(
      editComment(GRAPH, moveKey(bf4?.from ?? '', 'Bf4'), 'The London bishop'),
    );
    const saved = run(
      atBf4,
      { type: 'saving' },
      { type: 'saved', graph, version: 5 },
    );
    expect(saved.path.map((m) => [m.san, m.comment])).toEqual([
      ['d4', 'Solid'],
      ['d5', null],
      ['Bf4', 'The London bishop'],
    ]);
    expect(saved).toMatchObject({
      graph,
      version: 5,
      saving: false,
      revision: 0,
    });
  });

  it('keeps the longest start of the path still in the chapter', () => {
    const d5 = line(['d4', 'd5'])[1];
    const graph = edited(removeMove(GRAPH, 'c1', d5?.to ?? '', 'Bf4'));
    const saved = run(atBf4, { type: 'saved', graph, version: 5 });
    expect(sansOf(saved)).toEqual(['d4', 'd5']);
  });

  it('takes the chapter and path a save names', () => {
    const saved = run(START, {
      type: 'saved',
      graph: GRAPH,
      version: 5,
      chapterId: 'c2',
      path: line(['d4', 'Nf6'], GRAPH, 'c2'),
    });
    expect(saved.chapterId).toBe('c2');
    expect(sansOf(saved)).toEqual(['d4', 'Nf6']);
  });

  it('shows a refusal in the error tone; a stale version also marks the screen stale', () => {
    const refused = run(
      START,
      { type: 'saving' },
      { type: 'refused', reason: 'repertoire.illegalMove' },
    );
    expect(refused).toMatchObject({
      saving: false,
      stale: false,
      message: { key: 'repertoire.illegalMove', tone: 'error' },
    });
    expect(
      run(START, { type: 'refused', reason: 'repertoire.stale' }).stale,
    ).toBe(true);
    expect(
      run(START, { type: 'refused', reason: 'repertoire.x', values: { n: 1 } })
        .message,
    ).toEqual({ key: 'repertoire.x', tone: 'error', values: { n: 1 } });
  });

  it('bumps the revision on reset, so the board puts the pieces back', () => {
    expect(run(START, { type: 'reset' }, { type: 'reset' }).revision).toBe(2);
  });

  it('says a message and clears it', () => {
    const message = {
      key: 'repertoires.board.notInRepertoire',
      tone: 'info',
    } as const;
    const said = run(START, { type: 'say', message });
    expect(said.message).toEqual(message);
    expect(run(said, { type: 'say', message: null }).message).toBeNull();
  });
});

describe('screenReducer: builder controls', () => {
  it('switches mode and draw mode, chooses a colour and a first square', () => {
    const drawing = run(
      START,
      { type: 'mode', mode: 'build' },
      { type: 'draw', on: true },
      { type: 'drawColor', color: 'R' },
      { type: 'drawFrom', square: 'e4' },
    );
    expect(drawing).toMatchObject({
      mode: 'build',
      drawMode: true,
      drawColor: 'R',
      drawFrom: 'e4',
    });
    expect(run(drawing, { type: 'draw', on: false })).toMatchObject({
      drawMode: false,
      drawFrom: null,
    });
  });

  it('clears the status line on a mode switch, unless the repertoire is stale', () => {
    const message = {
      key: 'repertoires.board.notInRepertoire',
      tone: 'info',
    } as const;
    const said = run(START, { type: 'say', message });
    expect(run(said, { type: 'mode', mode: 'build' }).message).toBeNull();
    expect(
      run(
        said,
        { type: 'mode', mode: 'build' },
        { type: 'say', message },
        {
          type: 'mode',
          mode: 'browse',
        },
      ).message,
    ).toBeNull();
    const stale = run(START, { type: 'refused', reason: 'repertoire.stale' });
    expect(run(stale, { type: 'mode', mode: 'build' }).message).toEqual({
      key: 'repertoire.stale',
      tone: 'error',
    });
  });

  const drawingAtD5 = run(
    START,
    { type: 'mode', mode: 'build' },
    { type: 'goto', path: line(['d4', 'd5']) },
    { type: 'draw', on: true },
    { type: 'drawFrom', square: 'e4' },
  );

  it('forgets the first square on every step, and stays drawing on a move', () => {
    expect(run(drawingAtD5, { type: 'back' })).toMatchObject({
      drawMode: true,
      drawFrom: null,
    });
    expect(run(drawingAtD5, { type: 'forward' })).toMatchObject({
      drawMode: true,
      drawFrom: null,
    });
  });

  it('leaves draw mode at a chapter root (marks belong to a move) and in browse mode', () => {
    expect(run(drawingAtD5, { type: 'goto', path: [] }).drawMode).toBe(false);
    expect(
      run(drawingAtD5, { type: 'chapter', chapterId: 'c2' }).drawMode,
    ).toBe(false);
    expect(run(drawingAtD5, { type: 'mode', mode: 'browse' })).toMatchObject({
      mode: 'browse',
      drawMode: false,
      drawFrom: null,
    });
  });
});

describe('screenReducer: builder saves', () => {
  it('clears the saving message when a save lands, or says the one given', () => {
    const waiting = run(
      START,
      { type: 'saving' },
      {
        type: 'say',
        message: { key: 'repertoires.builder.saving', tone: 'info' },
      },
    );
    expect(
      run(waiting, { type: 'saved', graph: GRAPH, version: 5 }).message,
    ).toBeNull();
    const removed = {
      key: 'repertoires.builder.removed',
      tone: 'success',
    } as const;
    expect(
      run(waiting, {
        type: 'saved',
        graph: GRAPH,
        version: 5,
        message: removed,
      }).message,
    ).toEqual(removed);
  });

  it('can leave the repertoire without a chapter after the last one went', () => {
    const empty: RepertoireGraph = { side: 'white', chapters: [], moves: [] };
    const saved = run(run(START, { type: 'goto', path: line(['d4']) }), {
      type: 'saved',
      graph: empty,
      version: 5,
      chapterId: null,
    });
    expect(saved).toMatchObject({ chapterId: null, path: [] });
  });

  it('settles a save a field shows itself, keeping the message', () => {
    const settled = run(
      START,
      { type: 'say', message: { key: 'x.y', tone: 'info' } },
      { type: 'saving' },
      { type: 'settled' },
    );
    expect(settled).toMatchObject({
      saving: false,
      message: { key: 'x.y', tone: 'info' },
    });
  });

  it('drops "Saving" when a field’s save settles', () => {
    const settled = run(
      START,
      { type: 'saving' },
      {
        type: 'say',
        message: { key: 'repertoires.builder.saving', tone: 'info' },
      },
      { type: 'settled' },
    );
    expect(settled.message).toBeNull();
  });
});

describe('keepPath', () => {
  it('keeps nothing without a chapter', () => {
    expect(keepPath(GRAPH, null, line(['d4']))).toEqual([]);
  });

  it('stops at the first move the chapter no longer holds', () => {
    expect(keepPath(GRAPH, 'c2', line(['d4', 'd5']))).toEqual(
      line(['d4'], GRAPH, 'c2'),
    );
  });
});
