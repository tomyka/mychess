import type { DrawShape } from '@lichess-org/chessground/draw';
import { describe, expect, it, vi } from 'vitest';
import {
  boardConfig,
  cursorConfig,
  markBrushes,
  mountConfig,
  type BoardView,
} from './board-config';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const ARROW: DrawShape = { orig: 'g1', dest: 'f3', brush: 'green' };
const CIRCLE: DrawShape = { orig: 'd4', brush: 'red' };

const view = (over: Partial<BoardView> = {}): BoardView => ({
  fen: START,
  orientation: 'black',
  turnColor: 'white',
  check: false,
  lastMove: [],
  dests: new Map([['g1', ['f3', 'h3']]]),
  shapes: [ARROW],
  autoShapes: [CIRCLE],
  drawing: true,
  revision: 0,
  ...over,
});

describe('boardConfig', () => {
  it('shows the view: position, side, turn, check and last move', () => {
    const config = boardConfig(
      view({ check: true, lastMove: ['e2', 'e4'], turnColor: 'black' }),
    );
    expect(config.fen).toBe(START);
    expect(config.orientation).toBe('black');
    expect(config.turnColor).toBe('black');
    expect(config.check).toBe(true);
    expect(config.lastMove).toEqual(['e2', 'e4']);
    expect(config.coordinates).toBe(true);
    expect(config.highlight).toEqual({ lastMove: true, check: true });
  });

  it('clears the last move with an empty list when the view has none', () => {
    expect(boardConfig(view()).lastMove).toEqual([]);
  });

  it('moves only the side to move, only to the legal destinations', () => {
    const config = boardConfig(view());
    expect(config.movable).toEqual({
      free: false,
      color: 'white',
      showDests: true,
      dests: new Map([['g1', ['f3', 'h3']]]),
    });
    expect(config.premovable).toEqual({ enabled: false });
    expect(config.draggable).toEqual({ enabled: true, showGhost: true });
    expect(config.selectable).toEqual({ enabled: true });
  });

  it('copies the destinations so chessground cannot change the view', () => {
    const dests = new Map([['g1', ['f3']] as const]);
    const config = boardConfig(view({ dests }));
    config.movable?.dests?.get('g1')?.push('h3');
    expect(dests.get('g1')).toEqual(['f3']);
  });

  it('draws with the mouse only when the view says so, and never erases on a click', () => {
    expect(boardConfig(view()).drawable).toEqual({
      enabled: true,
      visible: true,
      eraseOnMovablePieceClick: false,
      defaultSnapToValidMove: false,
      shapes: [ARROW],
      autoShapes: [CIRCLE],
    });
    expect(boardConfig(view({ drawing: false })).drawable?.enabled).toBe(false);
  });
});

describe('cursorConfig', () => {
  it('marks the cursor square with the cursor class', () => {
    expect(cursorConfig('e4')).toEqual({
      highlight: { custom: new Map([['e4', 'cursor']]) },
    });
  });

  it('marks no square when the cursor is hidden', () => {
    expect(cursorConfig(null)).toEqual({ highlight: { custom: new Map() } });
  });
});

describe('markBrushes', () => {
  it('reads the four mark tokens into the brushes chessground draws with', () => {
    const read = vi.fn((name: string) => ` ${name}-value `);
    expect(markBrushes(read)).toEqual({
      green: {
        key: 'g',
        color: '--color-board-mark-green-value',
        opacity: 1,
        lineWidth: 10,
      },
      red: {
        key: 'r',
        color: '--color-board-mark-red-value',
        opacity: 1,
        lineWidth: 10,
      },
      yellow: {
        key: 'y',
        color: '--color-board-mark-yellow-value',
        opacity: 1,
        lineWidth: 10,
      },
      blue: {
        key: 'b',
        color: '--color-board-mark-blue-value',
        opacity: 1,
        lineWidth: 10,
      },
    });
  });
});

describe('mountConfig', () => {
  const handlers = { move: vi.fn(), select: vi.fn(), draw: vi.fn() };
  const brushes = markBrushes(() => '#000');

  const mounted = () =>
    mountConfig(view(), 'e4', { reducedMotion: false, brushes }, handlers);

  it('is the view and the cursor', () => {
    const config = mounted();
    expect(config.fen).toBe(START);
    expect(config.movable?.free).toBe(false);
    expect(config.movable?.dests).toEqual(new Map([['g1', ['f3', 'h3']]]));
    expect(config.highlight).toEqual({
      lastMove: true,
      check: true,
      custom: new Map([['e4', 'cursor']]),
    });
  });

  it('draws the view shapes with the mark brushes', () => {
    const { drawable } = mounted();
    expect(drawable?.brushes).toBe(brushes);
    expect(drawable?.shapes).toEqual([ARROW]);
    expect(drawable?.eraseOnMovablePieceClick).toBe(false);
  });

  it('reports a move to the move handler', () => {
    mounted().movable?.events?.after?.('e2', 'e4', { premove: false });
    expect(handlers.move).toHaveBeenCalledWith('e2', 'e4');
  });

  it('reports a pressed square and drawn shapes', () => {
    const config = mounted();
    config.events?.select?.('d4');
    expect(handlers.select).toHaveBeenCalledWith('d4');
    config.drawable?.onChange?.([CIRCLE]);
    expect(handlers.draw).toHaveBeenCalledWith([CIRCLE]);
  });

  it('slides the pieces for the duration-move token', () => {
    const config = mountConfig(
      view(),
      null,
      { reducedMotion: false, brushes },
      handlers,
    );
    expect(config.animation).toEqual({ enabled: true, duration: 150 });
  });

  it('does not animate when reduced motion is asked for', () => {
    const config = mountConfig(
      view(),
      null,
      { reducedMotion: true, brushes },
      handlers,
    );
    expect(config.animation?.enabled).toBe(false);
  });
});
