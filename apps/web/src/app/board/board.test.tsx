import type { Config } from '@lichess-org/chessground/config';
import type { DrawShape } from '@lichess-org/chessground/draw';
import type { Key } from '@lichess-org/chessground/types';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoardView } from './board-config';
import { Board, type BoardProps } from './board';

const ground = vi.hoisted(() => {
  const created: Config[] = [];
  /** Chessground's `state.drawable.current`: set while a shape is drawn. */
  const pen: { drawing: object | undefined } = { drawing: undefined };
  return {
    created,
    pen,
    set: vi.fn<(config: Config) => void>(),
    setShapes: vi.fn<(shapes: DrawShape[]) => void>(),
    selectSquare: vi.fn<(square: Key | null) => void>(),
    destroy: vi.fn<() => void>(),
  };
});

vi.mock('@lichess-org/chessground', () => ({
  Chessground: (_element: HTMLElement, config: Config) => {
    ground.created.push(config);
    return {
      set: ground.set,
      setShapes: ground.setShapes,
      selectSquare: ground.selectSquare,
      destroy: ground.destroy,
      state: {
        drawable: {
          get current() {
            return ground.pen.drawing;
          },
        },
      },
    };
  },
}));

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
const ARROW: DrawShape = { orig: 'g1', dest: 'f3', brush: 'green' };

const view = (over: Partial<BoardView> = {}): BoardView => ({
  fen: START,
  orientation: 'white',
  turnColor: 'white',
  check: false,
  lastMove: [],
  dests: new Map(),
  shapes: [ARROW],
  autoShapes: [],
  drawing: true,
  revision: 0,
  ...over,
});

const props = (over: Partial<BoardProps> = {}): BoardProps => ({
  view: view(),
  label: 'Chess board',
  describe: (square: Key) => `${square}, empty`,
  onMove: vi.fn(),
  ...over,
});

/** The configuration the board was created with. */
function mounted(): Config {
  const config = ground.created.at(-1);
  if (config === undefined) throw new Error('no board was created');
  return config;
}

/** The custom square classes of the last `set` that passed any. */
function lastCustom(): Map<Key, string> | undefined {
  const calls = ground.set.mock.calls;
  const withCustom = calls.filter(([c]) => c.highlight?.custom !== undefined);
  return withCustom.at(-1)?.[0].highlight?.custom;
}

const board = () => screen.getByRole('application', { name: 'Chess board' });

beforeEach(() => {
  ground.created.length = 0;
  ground.pen.drawing = undefined;
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Board', () => {
  it('creates one board for the view and destroys it on unmount', () => {
    const { unmount } = render(<Board {...props()} />);
    expect(ground.created).toHaveLength(1);
    expect(mounted().fen).toBe(START);
    expect(mounted().movable?.free).toBe(false);
    unmount();
    expect(ground.destroy).toHaveBeenCalledTimes(1);
  });

  it('keeps one live board under Strict Mode', () => {
    const { unmount } = render(
      <StrictMode>
        <Board {...props()} />
      </StrictMode>,
    );
    expect(ground.destroy).toHaveBeenCalledTimes(ground.created.length - 1);
    unmount();
    expect(ground.destroy).toHaveBeenCalledTimes(ground.created.length);
  });

  it('reconfigures the same board when the view changes', () => {
    const { rerender } = render(<Board {...props()} />);
    rerender(<Board {...props({ view: view({ fen: AFTER_E4 }) })} />);
    expect(ground.created).toHaveLength(1);
    expect(ground.set).toHaveBeenLastCalledWith(
      expect.objectContaining({ fen: AFTER_E4 }),
    );
  });

  it('reports a move to the latest move handler', () => {
    const first = vi.fn();
    const latest = vi.fn();
    const { rerender } = render(<Board {...props({ onMove: first })} />);
    rerender(<Board {...props({ onMove: latest })} />);
    act(() => {
      mounted().movable?.events?.after?.('e2', 'e4', { premove: false });
    });
    expect(latest).toHaveBeenCalledWith('e2', 'e4');
    expect(first).not.toHaveBeenCalled();
  });

  it('reports a pressed square', () => {
    const onSquare = vi.fn();
    render(<Board {...props({ onSquare })} />);
    act(() => {
      mounted().events?.select?.('d4');
    });
    expect(onSquare).toHaveBeenCalledWith('d4');
  });

  it('reports the shapes drawn with the mouse', () => {
    const onShapes = vi.fn();
    render(<Board {...props({ onShapes })} />);
    ground.pen.drawing = { orig: 'e2' };
    act(() => {
      mounted().drawable?.onChange?.([ARROW, { orig: 'd4', brush: 'red' }]);
    });
    expect(onShapes).toHaveBeenCalledWith([
      ARROW,
      { orig: 'd4', brush: 'red' },
    ]);
    expect(ground.setShapes).not.toHaveBeenCalled();
  });

  it('puts the shapes back when a click on the board erased them', () => {
    const onShapes = vi.fn();
    render(<Board {...props({ onShapes })} />);
    act(() => {
      mounted().drawable?.onChange?.([]);
    });
    expect(onShapes).not.toHaveBeenCalled();
    expect(ground.setShapes).toHaveBeenCalledWith([ARROW]);
  });

  it('creates the board with the mark tokens as brushes', () => {
    vi.stubGlobal('getComputedStyle', () => ({
      getPropertyValue: (name: string) => `${name}!`,
    }));
    render(<Board {...props()} />);
    expect(mounted().drawable?.brushes?.green.color).toBe(
      '--color-board-mark-green!',
    );
    expect(mounted().drawable?.brushes?.blue.color).toBe(
      '--color-board-mark-blue!',
    );
  });

  it('animates moves unless reduced motion is asked for', () => {
    render(<Board {...props()} />);
    expect(mounted().animation?.enabled).toBe(true);
  });

  it('does not animate when the system asks for reduced motion', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
    }));
    render(<Board {...props()} />);
    expect(mounted().animation?.enabled).toBe(false);
  });
});

describe('Board keyboard', () => {
  it('is one tab stop with an accessible name', () => {
    render(<Board {...props()} />);
    expect(board().tabIndex).toBe(0);
  });

  it('shows the cursor at the bottom-left square on keyboard focus', () => {
    render(<Board {...props()} />);
    vi.spyOn(board(), 'matches').mockReturnValue(true);
    fireEvent.focus(board());
    expect(lastCustom()).toEqual(new Map([['a1', 'cursor']]));
  });

  it('shows no cursor when focus came from a pointer', () => {
    render(<Board {...props()} />);
    vi.spyOn(board(), 'matches').mockReturnValue(false);
    fireEvent.focus(board());
    expect(lastCustom()).toEqual(new Map());
  });

  it('moves the cursor with the arrow keys and announces the square', () => {
    render(<Board {...props()} />);
    fireEvent.keyDown(board(), { key: 'ArrowUp' });
    expect(lastCustom()).toEqual(new Map([['a2', 'cursor']]));
    expect(screen.getByText('a2, empty')).toBeDefined();
    fireEvent.keyDown(board(), { key: 'ArrowRight' });
    expect(lastCustom()).toEqual(new Map([['b2', 'cursor']]));
  });

  it('moves the cursor from the bottom-left as Black sees it', () => {
    render(<Board {...props({ view: view({ orientation: 'black' }) })} />);
    fireEvent.keyDown(board(), { key: 'ArrowUp' });
    expect(lastCustom()).toEqual(new Map([['h7', 'cursor']]));
  });

  it('picks up and drops on the cursor square with Enter or Space', () => {
    render(<Board {...props()} />);
    fireEvent.keyDown(board(), { key: 'ArrowUp' });
    fireEvent.keyDown(board(), { key: 'Enter' });
    expect(ground.selectSquare).toHaveBeenLastCalledWith('a2');
    fireEvent.keyDown(board(), { key: 'ArrowUp' });
    fireEvent.keyDown(board(), { key: ' ' });
    expect(ground.selectSquare).toHaveBeenLastCalledWith('a3');
  });

  it('cancels with Escape and tells the page', () => {
    const onEscape = vi.fn();
    render(<Board {...props({ onEscape })} />);
    fireEvent.keyDown(board(), { key: 'Escape' });
    expect(ground.selectSquare).toHaveBeenLastCalledWith(null);
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it('ignores other keys', () => {
    render(<Board {...props()} />);
    fireEvent.keyDown(board(), { key: 'Tab' });
    expect(ground.selectSquare).not.toHaveBeenCalled();
    expect(lastCustom()).toEqual(new Map());
  });

  it('hides the cursor when focus leaves and keeps its square', () => {
    render(<Board {...props()} />);
    fireEvent.keyDown(board(), { key: 'ArrowUp' });
    fireEvent.blur(board());
    expect(lastCustom()).toEqual(new Map());
    fireEvent.keyDown(board(), { key: 'ArrowRight' });
    expect(lastCustom()).toEqual(new Map([['b2', 'cursor']]));
  });
});
