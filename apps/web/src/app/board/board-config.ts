import type { Config } from '@lichess-org/chessground/config';
import type { DrawBrushes, DrawShape } from '@lichess-org/chessground/draw';
import type { Color, Key } from '@lichess-org/chessground/types';

/** Everything the board shows, as plain data the page computes. */
export interface BoardView {
  readonly fen: string;
  readonly orientation: Color;
  readonly turnColor: Color;
  readonly check: boolean;
  readonly lastMove: readonly Key[];
  /** The legal destinations; empty while saving, in draw mode, or read-only. */
  readonly dests: ReadonlyMap<Key, readonly Key[]>;
  /** Shapes the person may change with the mouse (builder). */
  readonly shapes: readonly DrawShape[];
  /** Shapes shown only (browsing). */
  readonly autoShapes: readonly DrawShape[];
  /** Mouse drawing on (builder). */
  readonly drawing: boolean;
  /** Draw mode: a press chooses a square; no piece is selected or dragged. */
  readonly picking: boolean;
  /** Draw mode's first chosen square, marked until the second. */
  readonly picked: Key | null;
  /** Bumped to put the pieces back after a move the page did not take. */
  readonly revision: number;
  /**
   * Classes on squares (board.css): a training answer's flash, a hint's
   * piece. Absent, none.
   */
  readonly marked?: ReadonlyMap<Key, string>;
}

/**
 * Chessground's configuration for a view (Verified library API). Its
 * defaults let any piece move anywhere and premove, so both are switched
 * off; `fen` is always passed, which also resets the user shapes to the
 * view's.
 */
export function boardConfig(view: BoardView): Config {
  return { fen: view.fen, ...withoutPosition(view) };
}

/** Everything of a view but the position: the pieces stay as they are. */
function withoutPosition(view: BoardView): Config {
  return {
    orientation: view.orientation,
    turnColor: view.turnColor,
    check: view.check,
    lastMove: [...view.lastMove],
    coordinates: true,
    highlight: { lastMove: true, check: true },
    movable: {
      free: false,
      color: view.turnColor,
      showDests: true,
      dests: new Map([...view.dests].map(([from, to]) => [from, [...to]])),
    },
    premovable: { enabled: false },
    draggable: { enabled: !view.picking, showGhost: true },
    selectable: { enabled: !view.picking },
    drawable: {
      enabled: view.drawing,
      visible: true,
      eraseOnMovablePieceClick: false,
      defaultSnapToValidMove: false,
      shapes: [...view.shapes],
      autoShapes: [...view.autoShapes],
    },
  };
}

/** What the board last showed: a new position or revision is passed again. */
export type ShownPosition = Pick<BoardView, 'fen' | 'revision'>;

/**
 * The configuration for a new view of a live board. The position is passed
 * only when it or the revision changed: passing it puts every piece back,
 * and a piece just played must stay on its square while the page saves it
 * (docs/design/repertoire-screen.md, Saving).
 */
export function boardUpdate(
  view: BoardView,
  shown: ShownPosition | null,
): Config {
  const same =
    shown !== null &&
    shown.fen === view.fen &&
    shown.revision === view.revision;
  return same ? withoutPosition(view) : boardConfig(view);
}

const NONE_MARKED: ReadonlyMap<Key, string> = new Map();

/**
 * The keyboard cursor (board.css `square.cursor`) and draw mode's first
 * square (`square.selected`: chessground marks only a selected piece) as
 * custom square classes, after the view's own (`marked`). Kept apart from
 * `boardConfig` so moving the cursor does not pass `fen` and put back a
 * piece the page is still saving.
 */
export function cursorConfig(
  cursor: Key | null,
  picked: Key | null = null,
  marked: ReadonlyMap<Key, string> = NONE_MARKED,
): Config {
  const custom = new Map<Key, string>(marked);
  const add = (square: Key, name: string): void => {
    const before = custom.get(square);
    custom.set(square, before === undefined ? name : `${before} ${name}`);
  };
  if (cursor !== null) add(cursor, 'cursor');
  if (picked !== null) add(picked, 'selected');
  return { highlight: { custom } };
}

const brush = (key: string, color: string) => ({
  key,
  color: color.trim(),
  opacity: 1,
  lineWidth: 10,
});

/**
 * The four mark colours from their tokens (docs/design/repertoire-screen.md,
 * "Arrow and circle colours"): chessground sets a brush colour as an SVG
 * attribute, which CSS cannot reach, so the board reads the tokens once.
 */
export function markBrushes(read: (token: string) => string): DrawBrushes {
  return {
    green: brush('g', read('--color-board-mark-green')),
    red: brush('r', read('--color-board-mark-red')),
    yellow: brush('y', read('--color-board-mark-yellow')),
    blue: brush('b', read('--color-board-mark-blue')),
    // The training screen's expected move (docs/design/training-screen.md).
    arrow: brush('a', read('--color-board-arrow')),
  };
}

/** What the board reports to the component that made it. */
export interface BoardHandlers {
  readonly move: (orig: Key, dest: Key) => void;
  readonly select: (square: Key) => void;
  readonly draw: (shapes: DrawShape[]) => void;
}

export interface MountOptions {
  /** `prefers-reduced-motion: reduce`: chessground animates in script. */
  readonly reducedMotion: boolean;
  readonly brushes: DrawBrushes;
}

/** The `duration-move` token (tokens.css), in milliseconds. */
export const MOVE_DURATION = 150;

/** The configuration a board is created with: view, cursor, brushes, handlers. */
export function mountConfig(
  view: BoardView,
  cursor: Key | null,
  options: MountOptions,
  handlers: BoardHandlers,
): Config {
  const base = boardConfig(view);
  return {
    ...base,
    highlight: {
      ...base.highlight,
      ...cursorConfig(cursor, view.picked, view.marked).highlight,
    },
    animation: { enabled: !options.reducedMotion, duration: MOVE_DURATION },
    movable: {
      ...base.movable,
      events: {
        after: (orig, dest) => {
          handlers.move(orig, dest);
        },
      },
    },
    events: { select: handlers.select },
    drawable: {
      ...base.drawable,
      brushes: options.brushes,
      onChange: handlers.draw,
    },
  };
}
