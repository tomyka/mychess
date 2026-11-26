import { renderHook } from '@testing-library/react';
import {
  fenOf,
  legalMoves,
  positionAfterMove,
  positionKey,
  START_KEY,
  type BoardMove,
} from '@mychess/chess';
import { describe, expect, it } from 'vitest';
import { graphOf, LONDON } from '../../../test/fixtures/repertoires';
import type { TrainingData } from '../../lib/training-data';
import { drillBoard, useDrillBoard } from './drill-board';
import {
  answerFlash,
  drillFrame,
  type Asked,
  type DrillFrame,
  type Flash,
} from './drill-frame';

const AFTER_D4 = positionKey(
  'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1',
);

/** The start position asked, a move taken, nothing marked. */
function frame(
  overrides: Partial<Asked> = {},
  flash: Flash | null = null,
  revision = 0,
): DrillFrame {
  const asked: Asked = {
    repertoireId: undefined,
    chapterId: undefined,
    key: START_KEY,
    last: undefined,
    playable: true,
    typeable: true,
    ...overrides,
  };
  return drillFrame(asked, { flash, revision });
}

const E2_E4: BoardMove = { orig: 'e2', dest: 'e4', san: 'e4', promotion: null };

/** The board's square classes for `f`, in order. */
const markedOf = (f: DrillFrame) => [
  ...(drillBoard(f, 'white', []).marked ?? []),
];

describe('the drill board', () => {
  it('shows the position from the side, with the side to move', () => {
    const after = frame({ key: AFTER_D4, last: 'd2d4' });
    const view = drillBoard(after, 'black', []);
    expect(view.fen).toBe(fenOf(AFTER_D4));
    expect(view.orientation).toBe('black');
    expect(view.turnColor).toBe('black');
    expect(view.check).toBe(false);
    expect(view.lastMove).toEqual(['d2', 'd4']);
  });

  it('shows no last move before the first, White to move', () => {
    const view = drillBoard(frame(), 'white', []);
    expect(view.lastMove).toEqual([]);
    expect(view.turnColor).toBe('white');
  });

  it('shows a check', () => {
    const fools = positionKey(
      'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3',
    );
    expect(drillBoard(frame({ key: fools }), 'white', []).check).toBe(true);
  });

  it('takes the legal moves only while the frame takes one', () => {
    const legal = [E2_E4];
    expect([...drillBoard(frame(), 'white', legal).dests]).toEqual([
      ['e2', ['e4']],
    ]);
    const locked = frame({ playable: false });
    expect(drillBoard(locked, 'white', legal).dests.size).toBe(0);
  });

  it('draws the asked move as an arrow, and none without one', () => {
    const arrowed = frame({ arrow: 'd2d4' });
    expect(drillBoard(arrowed, 'white', []).autoShapes).toEqual([
      { orig: 'd2', dest: 'd4', brush: 'arrow' },
    ]);
    expect(drillBoard(frame(), 'white', []).autoShapes).toEqual([]);
    const notAMove = frame({ arrow: 'xx' });
    expect(drillBoard(notAMove, 'white', []).autoShapes).toEqual([]);
  });

  it('marks the hinted piece and the answer’s flash, the flash over the hint', () => {
    const flash: Flash = { square: 'e4', kind: 'wrong' };
    expect(markedOf(frame({ hint: 'd2d4' }, flash))).toEqual([
      ['d2', 'hint'],
      ['e4', 'wrong'],
    ]);
    const onHint = frame({ hint: 'd2d4' }, { square: 'd2', kind: 'correct' });
    expect(markedOf(onHint)).toEqual([['d2', 'correct']]);
    expect(markedOf(frame())).toEqual([]);
    const offBoard = frame({}, { square: 'z9', kind: 'wrong' });
    expect(markedOf(offBoard)).toEqual([]);
  });

  it('draws a held wrong move as the frame holds it, its side to move, without the arrow, hint or moves (#381)', () => {
    const a3: BoardMove = {
      orig: 'a2',
      dest: 'a3',
      san: 'a3',
      promotion: null,
    };
    const flash = answerFlash(START_KEY, a3, false);
    const held = frame({ arrow: 'e2e4', hint: 'e2e4' }, flash);
    const view = drillBoard(held, 'white', legalMoves(START_KEY));
    const after = positionAfterMove(START_KEY, a3);
    expect(view.fen).toBe(fenOf(after));
    expect(view.turnColor).toBe('black');
    expect(view.lastMove).toEqual(['a2', 'a3']);
    expect(view.autoShapes).toEqual([]);
    expect(view.dests.size).toBe(0);
    expect([...(view.marked ?? [])]).toEqual([['a3', 'wrong']]);
  });

  it('passes the revision on, nothing drawn by hand', () => {
    const view = drillBoard(frame({}, null, 3), 'white', []);
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
      chapterTitles: {},
      graph: graphOf(LONDON),
    },
    {
      id: SICILIAN_ID,
      name: 'Sicilijos gynyba',
      side: 'black',
      kind: 'own',
      active: true,
      chapterTitles: { c1: 'Najdorfas' },
      graph: graphOf(LONDON),
    },
  ],
  others: [],
  reviews: [],
  tracked: [],
  knownWithoutLearning: [],
  learnedToday: 0,
  coachNotes: [],
  settings: { sessionSize: 20, newPerDay: 10, learnArrows: true },
  now: new Date('2026-10-25T08:00:00Z'),
};

/** The drill board hook over `f`. */
const renderBoard = (f: DrillFrame) =>
  renderHook(({ shown }: { shown: DrillFrame }) => useDrillBoard(data, shown), {
    initialProps: { shown: f },
  });

describe('the drill board hook', () => {
  it('shows the board from the side of the repertoire drilled, the item named by it and its chapter (R-224)', () => {
    const { result } = renderBoard(
      frame({ repertoireId: SICILIAN_ID, chapterId: 'c1' }),
    );
    expect(result.current.view.orientation).toBe('black');
    expect(result.current.item).toEqual({
      name: 'Sicilijos gynyba',
      side: 'black',
      chapter: 'Najdorfas',
    });
  });

  it('names no chapter when the line has none, or the entry has no title for it', () => {
    const none = renderBoard(frame({ repertoireId: SICILIAN_ID }));
    expect(none.result.current.item?.chapter).toBeNull();
    const unknown = renderBoard(
      frame({ repertoireId: SICILIAN_ID, chapterId: 'c9' }),
    );
    expect(unknown.result.current.item).toEqual({
      name: 'Sicilijos gynyba',
      side: 'black',
      chapter: null,
    });
  });

  it('shows the board from White, with no item, without a known repertoire', () => {
    const { result } = renderBoard(frame({ chapterId: 'c1' }));
    expect(result.current.view.orientation).toBe('white');
    expect(result.current.item).toBeUndefined();
  });

  it('gives the asked position’s legal moves, also while a wrong move is held', () => {
    const { result } = renderBoard(frame({ repertoireId: LONDON_ID }));
    expect(result.current.legal).toHaveLength(20);
    const a3: BoardMove = {
      orig: 'a2',
      dest: 'a3',
      san: 'a3',
      promotion: null,
    };
    const held = renderBoard(
      frame({ key: START_KEY }, answerFlash(START_KEY, a3, false)),
    );
    expect(held.result.current.legal).toHaveLength(20);
    expect(held.result.current.view.dests.size).toBe(0);
  });

  it('keeps the view while the frame is the same', () => {
    const f = frame({ repertoireId: LONDON_ID });
    const board = renderBoard(f);
    const first = board.result.current.view;
    board.rerender({ shown: f });
    expect(board.result.current.view).toBe(first);
  });
});
