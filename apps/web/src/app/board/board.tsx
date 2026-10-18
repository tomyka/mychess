'use client';

import { Chessground } from '@lichess-org/chessground';
import type { Api } from '@lichess-org/chessground/api';
import type { DrawShape } from '@lichess-org/chessground/draw';
import type { Key } from '@lichess-org/chessground/types';
import '@lichess-org/chessground/assets/chessground.base.css';
import '@lichess-org/chessground/assets/chessground.cburnett.css';
import './board.css';
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type FocusEvent,
  type JSX,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import {
  boardUpdate,
  cursorConfig,
  markBrushes,
  mountConfig,
  type BoardView,
  type ShownPosition,
} from './board-config';
import { cursorStart, stepCursor } from './cursor';

export interface BoardProps {
  readonly view: BoardView;
  /** The accessible name of the board (a catalogue text). */
  readonly label: string;
  /** What to announce for the cursor square: square, then piece or empty. */
  readonly describe: (square: Key) => string;
  readonly onMove: (orig: Key, dest: Key) => void;
  /** Every square pressed or chosen with Enter (draw mode uses it). */
  readonly onSquare?: (square: Key) => void;
  /** The shapes drawn with the mouse (builder). */
  readonly onShapes?: (shapes: DrawShape[]) => void;
  /** Escape on the board (draw mode leaves on it). */
  readonly onEscape?: () => void;
}

/** Is the system asking for less motion? jsdom has no `matchMedia`. */
function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Was the shape change the person's own drawing? Chessground also clears the
 * user shapes when a square without a movable piece is pressed while drawing
 * is on, and has no option to stop it; only a drawing in progress has
 * `drawable.current` set when `onChange` fires.
 */
const isDrawing = (ground: Api): boolean =>
  ground.state.drawable.current !== undefined;

/**
 * Creates the chessground board on mount (with the mark brushes and the
 * motion preference read once), passes it every new view and cursor, and
 * destroys it on unmount. The handlers are effect events, so the board is
 * created once and still calls the latest props.
 */
function useGround(
  host: RefObject<HTMLDivElement | null>,
  props: BoardProps,
  cursor: Key | null,
): RefObject<Api | null> {
  const api = useRef<Api | null>(null);
  const { view } = props;

  const moved = useEffectEvent((orig: Key, dest: Key) => {
    props.onMove(orig, dest);
  });
  const pressed = useEffectEvent((square: Key) => {
    props.onSquare?.(square);
  });
  const drawn = useEffectEvent((shapes: DrawShape[]) => {
    const ground = api.current;
    if (ground !== null && !isDrawing(ground))
      ground.setShapes([...view.shapes]);
    else props.onShapes?.([...shapes]);
  });
  const create = useEffectEvent((element: HTMLDivElement): Api => {
    const style = getComputedStyle(element);
    const options = {
      reducedMotion: prefersReducedMotion(),
      brushes: markBrushes((token) => style.getPropertyValue(token)),
    };
    return Chessground(
      element,
      mountConfig(view, cursor, options, {
        move: (orig, dest) => {
          moved(orig, dest);
        },
        select: (square) => {
          pressed(square);
        },
        draw: (shapes) => {
          drawn(shapes);
        },
      }),
    );
  });

  useEffect(() => {
    const element = host.current;
    if (element === null) return undefined;
    const ground = create(element);
    api.current = ground;
    return () => {
      ground.destroy();
      api.current = null;
    };
  }, [host]);
  useViewUpdates(api, view);
  const { picked } = view;
  useEffect(() => {
    api.current?.set(cursorConfig(cursor, picked));
  }, [cursor, picked]);
  return api;
}

/**
 * Passes each new view to the live board; the position only when it or the
 * revision changed, so a piece just played stays while the page saves it.
 */
function useViewUpdates(api: RefObject<Api | null>, view: BoardView): void {
  const shown = useRef<ShownPosition | null>(null);
  useEffect(() => {
    const ground = api.current;
    if (ground === null) return;
    ground.set(boardUpdate(view, shown.current));
    shown.current = { fen: view.fen, revision: view.revision };
  }, [api, view]);
}

/**
 * The keyboard cursor: shown while the board has keyboard focus, moved by
 * the arrow keys relative to the board's orientation, announced through the
 * live region. Its square is kept while focus is away.
 */
function useCursor(props: BoardProps) {
  const { view, describe } = props;
  const [square, setSquare] = useState<Key | null>(null);
  const [visible, setVisible] = useState(false);
  const [said, setSaid] = useState('');
  const at = square ?? cursorStart(view.orientation);

  function step(next: Key): void {
    setSquare(next);
    setVisible(true);
    setSaid(describe(next));
  }

  return {
    shown: visible ? at : null,
    said,
    /** Mouse focus shows no cursor; keyboard focus does. */
    onFocus: (event: FocusEvent<HTMLDivElement>) => {
      setVisible(event.currentTarget.matches(':focus-visible'));
    },
    onBlur: () => {
      setVisible(false);
    },
    /** The arrow keys move the cursor; any other key is for the board. */
    onKey: (event: KeyboardEvent<HTMLDivElement>): Key | null => {
      const next = stepCursor(at, event.key, view.orientation);
      if (next === null) return at;
      event.preventDefault();
      step(next);
      return null;
    },
    reveal: () => {
      setVisible(true);
    },
  };
}

/**
 * The chessground board (R-97): created once on mount, reconfigured when the
 * view changes, destroyed on unmount. One tab stop: the arrow keys move a
 * cursor, Enter or Space picks up and drops, Escape cancels
 * (docs/design/repertoire-screen.md, Keyboard and screen readers).
 */
export function Board(props: BoardProps): JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const cursor = useCursor(props);
  const api = useGround(host, props, cursor.shown);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const at = cursor.onKey(event);
    if (at === null) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      cursor.reveal();
      api.current?.selectSquare(at);
    } else if (event.key === 'Escape') {
      api.current?.selectSquare(null);
      props.onEscape?.();
    }
  }

  return (
    <div className="flex flex-col">
      <div
        ref={host}
        role="application"
        aria-label={props.label}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onFocus={cursor.onFocus}
        onBlur={cursor.onBlur}
        className="aspect-square w-full touch-manipulation max-lg:focus-visible:outline-none lg:overflow-hidden lg:rounded-board"
      />
      <p aria-live="polite" className="sr-only">
        {cursor.said}
      </p>
    </div>
  );
}
