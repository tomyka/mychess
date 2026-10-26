import { act, renderHook } from '@testing-library/react';
import { fenOf, positionKey, START_KEY, type BoardMove } from '@mychess/chess';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { graphOf, LONDON } from '../../../test/fixtures/repertoires';
import type { TrainingData } from '../../lib/training-data';
import { drillBoard, useDrillBoard, type DrillPosition } from './drill-board';
import type { Flash } from './drill-input';

const AFTER_D4 = positionKey(
  'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1',
);

/** The start position, waiting for White's move, nothing marked. */
function position(overrides: Partial<DrillPosition> = {}): DrillPosition {
  return {
    key: START_KEY,
    last: undefined,
    playable: true,
    flash: null,
    revision: 0,
    ...overrides,
  };
}

const E2_E4: BoardMove = { orig: 'e2', dest: 'e4', san: 'e4', promotion: null };

/** The board's square classes for `p`, in order. */
const markedOf = (p: DrillPosition) => [
  ...(drillBoard(p, 'white', []).marked ?? []),
];

describe('the drill board', () => {
  it('shows the position from the side, with the side to move', () => {
    const after = position({ key: AFTER_D4, last: 'd2d4' });
    const view = drillBoard(after, 'black', []);
    expect(view.fen).toBe(fenOf(AFTER_D4));
    expect(view.orientation).toBe('black');
    expect(view.turnColor).toBe('black');
    expect(view.check).toBe(false);
    expect(view.lastMove).toEqual(['d2', 'd4']);
  });

  it('shows no last move before the first, White to move', () => {
    const view = drillBoard(position(), 'white', []);
    expect(view.lastMove).toEqual([]);
    expect(view.turnColor).toBe('white');
  });

  it('shows a check', () => {
    const fools = positionKey(
      'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3',
    );
    expect(drillBoard(position({ key: fools }), 'white', []).check).toBe(true);
  });

  it('takes the legal moves only while the drill takes one', () => {
    const legal = [E2_E4];
    expect([...drillBoard(position(), 'white', legal).dests]).toEqual([
      ['e2', ['e4']],
    ]);
    const locked = position({ playable: false });
    expect(drillBoard(locked, 'white', legal).dests.size).toBe(0);
  });

  it('draws the asked move as an arrow, and none without one', () => {
    const arrowed = position({ arrow: 'd2d4' });
    expect(drillBoard(arrowed, 'white', []).autoShapes).toEqual([
      { orig: 'd2', dest: 'd4', brush: 'arrow' },
    ]);
    expect(drillBoard(position(), 'white', []).autoShapes).toEqual([]);
    const notAMove = position({ arrow: 'xx' });
    expect(drillBoard(notAMove, 'white', []).autoShapes).toEqual([]);
  });

  it('marks the hinted piece and the answer’s flash, the flash over the hint', () => {
    const flash: Flash = { square: 'e4', kind: 'wrong' };
    expect(markedOf(position({ hint: 'd2d4', flash }))).toEqual([
      ['d2', 'hint'],
      ['e4', 'wrong'],
    ]);
    const onHint = position({
      hint: 'd2d4',
      flash: { square: 'd2', kind: 'correct' },
    });
    expect(markedOf(onHint)).toEqual([['d2', 'correct']]);
    expect(markedOf(position())).toEqual([]);
    const offBoard = position({ flash: { square: 'z9', kind: 'wrong' } });
    expect(markedOf(offBoard)).toEqual([]);
  });

  it('passes the revision on, nothing drawn by hand', () => {
    const view = drillBoard(position({ revision: 3 }), 'white', []);
    expect(view.revision).toBe(3);
    expect(view.shapes).toEqual([]);
    expect(view.drawing).toBe(false);
    expect(view.picking).toBe(false);
    expect(view.picked).toBeNull();
  });
});

const LONDON_ID = 'london';
const SICILIAN_ID = 'sicilian';

const data: TrainingData = {
  mode: 'review',
  entries: [
    {
      id: LONDON_ID,
      name: 'Londono sistema',
      side: 'white',
      kind: 'own',
      active: true,
      graph: graphOf(LONDON),
    },
    {
      id: SICILIAN_ID,
      name: 'Sicilijos gynyba',
      side: 'black',
      kind: 'own',
      active: true,
      graph: graphOf(LONDON),
    },
  ],
  others: [],
  reviews: [],
  learned: [],
  learnedToday: 0,
  settings: { sessionSize: 20, newPerDay: 10 },
  now: new Date('2026-10-25T08:00:00Z'),
};

interface Drilled {
  readonly flash: Flash | null;
  readonly repertoireId: string | undefined;
}

const positionOf = (s: Drilled): DrillPosition => position({ flash: s.flash });
const repertoireOf = (s: Drilled): string | undefined => s.repertoireId;

/** The drill board over a state the test sets, and the state's setter. */
function renderBoard(initial: Drilled) {
  let state = initial;
  const setState = vi.fn((next: Drilled | ((s: Drilled) => Drilled)) => {
    state = typeof next === 'function' ? next(state) : next;
  });
  const hook = renderHook(
    ({ s }: { s: Drilled }) =>
      useDrillBoard({ data, state: s, setState, positionOf, repertoireOf }),
    { initialProps: { s: initial } },
  );
  return { hook, setState, current: () => state };
}

/** Lets `ms` of the board's timers run. */
function wait(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the drill board hook', () => {
  it('shows the board from the side of the repertoire drilled, titled with its name', () => {
    const { hook } = renderBoard({ flash: null, repertoireId: SICILIAN_ID });
    expect(hook.result.current.view.orientation).toBe('black');
    expect(hook.result.current.titled).toEqual({ title: 'Sicilijos gynyba' });
  });

  it('shows the board from White, untitled, without a known repertoire', () => {
    const { hook } = renderBoard({ flash: null, repertoireId: undefined });
    expect(hook.result.current.view.orientation).toBe('white');
    expect(hook.result.current.titled).toEqual({});
  });

  it('gives the position’s legal moves', () => {
    const { hook } = renderBoard({ flash: null, repertoireId: LONDON_ID });
    expect(hook.result.current.legal).toHaveLength(20);
  });

  it('keeps the view while the state is the same', () => {
    const board = renderBoard({ flash: null, repertoireId: LONDON_ID });
    const first = board.hook.result.current.view;
    board.hook.rerender({ s: board.current() });
    expect(board.hook.result.current.view).toBe(first);
  });

  it('ends a flash after the feedback time', () => {
    const flash: Flash = { square: 'e4', kind: 'wrong' };
    const board = renderBoard({ flash, repertoireId: LONDON_ID });
    wait(399);
    expect(board.current().flash).toBe(flash);
    wait(1);
    expect(board.current().flash).toBeNull();
  });

  it('leaves a newer flash for its own time', () => {
    const first: Flash = { square: 'e4', kind: 'wrong' };
    const board = renderBoard({ flash: first, repertoireId: LONDON_ID });
    wait(200);
    const second: Flash = { square: 'd4', kind: 'correct' };
    board.hook.rerender({ s: { flash: second, repertoireId: LONDON_ID } });
    wait(200);
    expect(board.hook.result.current.view.marked?.get('d4')).toBe('correct');
    expect(board.setState).not.toHaveBeenCalled();
    wait(200);
    expect(board.setState).toHaveBeenCalledTimes(1);
  });
});
