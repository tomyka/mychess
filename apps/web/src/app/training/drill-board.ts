'use client';

// What both drills put on the board: the position, the moves it takes, the
// arrow, the hint's piece and the answer's flash, from the side of the
// repertoire drilled, and that repertoire's name as the frame's title. Each
// drill's state says which position and marks; this draws them.
import type { DrawShape } from '@lichess-org/chessground/draw';
import type { Key } from '@lichess-org/chessground/types';
import {
  fenOf,
  inCheck,
  legalMoves,
  sideToMove,
  type BoardMove,
  type Side,
} from '@mychess/chess';
import { useMemo, type Dispatch, type SetStateAction } from 'react';
import type { TrainingData } from '../../lib/training-data';
import type { BoardView } from '../board/board-config';
import { destsOf, isKey, squaresOf } from '../board/squares';
import { FEEDBACK_MS, useTimer, type Flash } from './drill-input';
import type { HeaderItem } from './session-header';

/** What a drill has on the board now. */
export interface DrillPosition {
  /** The position, as a position key. */
  readonly key: string;
  /** The move that led to it (UCI), if any. */
  readonly last: string | undefined;
  /** Does the board take a move now? */
  readonly playable: boolean;
  /** The move shown as an arrow (UCI), if any. */
  readonly arrow?: string | undefined;
  /** The move whose piece is marked as the hint (UCI), if any. */
  readonly hint?: string | undefined;
  readonly flash: Flash | null;
  /** Bumped to put a refused piece back (BoardView.revision). */
  readonly revision: number;
}

function arrowsOf(p: DrillPosition): DrawShape[] {
  const [orig, dest] = p.arrow === undefined ? [] : squaresOf(p.arrow);
  if (orig === undefined || dest === undefined) return [];
  return [{ orig, dest, brush: 'arrow' }];
}

/** The hint's piece and the answer's flash, as square classes. */
function markedOf(p: DrillPosition): Map<Key, string> {
  const marked = new Map<Key, string>();
  const [from] = p.hint === undefined ? [] : squaresOf(p.hint);
  if (from !== undefined) marked.set(from, 'hint');
  const { flash } = p;
  if (flash !== null && isKey(flash.square))
    marked.set(flash.square, flash.kind);
  return marked;
}

const NO_DESTS: ReadonlyMap<Key, readonly Key[]> = new Map();

/** The side to move in the position `key`, in the board's words. */
const colorToMove = (key: string): BoardView['turnColor'] =>
  sideToMove(key) === 'w' ? 'white' : 'black';

/**
 * `p` as the board shows it: a wrong move held for its flash in place of
 * the asked position, with no arrow, hint or move taken (#381, R-59).
 */
function shownPosition(p: DrillPosition): DrillPosition {
  const held = p.flash?.kind === 'wrong' ? p.flash.after : undefined;
  if (held === undefined) return p;
  return {
    ...p,
    key: held.key,
    last: held.uci,
    playable: false,
    arrow: undefined,
    hint: undefined,
  };
}

/**
 * What the board shows of `asked`, from `side`, with the position's `legal`
 * moves (the asked position's: while a wrong move is held none are taken).
 */
export function drillBoard(
  asked: DrillPosition,
  side: Side,
  legal: readonly BoardMove[],
): BoardView {
  const p = shownPosition(asked);
  return {
    fen: fenOf(p.key),
    orientation: side,
    turnColor: colorToMove(p.key),
    check: inCheck(p.key),
    lastMove: p.last === undefined ? [] : squaresOf(p.last),
    dests: p.playable ? destsOf(legal) : NO_DESTS,
    shapes: [],
    autoShapes: arrowsOf(p),
    drawing: false,
    picking: false,
    picked: null,
    revision: p.revision,
    marked: markedOf(p),
  };
}

type Entry = TrainingData['entries'][number];

const entryOf = (
  data: TrainingData,
  repertoireId: string | undefined,
): Entry | undefined => data.entries.find((e) => e.id === repertoireId);

/** The item drilled, as the header names it: repertoire, side and chapter (R-224). */
function itemOf(
  entry: Entry | undefined,
  chapterId: string | undefined,
): HeaderItem | undefined {
  if (entry === undefined) return undefined;
  const chapter =
    chapterId === undefined ? undefined : entry.chapterTitles[chapterId];
  return { name: entry.name, side: entry.side, chapter: chapter ?? null };
}

/** A drill's state: it keeps the answer's flash. */
interface Flashing {
  readonly flash: Flash | null;
}

/** Where the board's view comes from. */
interface BoardSource<S extends Flashing> {
  readonly data: TrainingData;
  readonly state: S;
  readonly setState: Dispatch<SetStateAction<S>>;
  /** The state's position; a module function, so the view is kept with it. */
  readonly positionOf: (s: S) => DrillPosition;
  /** The repertoire drilled, if any. */
  readonly repertoireOf: (s: S) => string | undefined;
  /** The chapter of the item drilled, if any. */
  readonly chapterOf: (s: S) => string | undefined;
}

export interface DrillBoard {
  readonly view: BoardView;
  /** The legal moves of the position on the board. */
  readonly legal: readonly BoardMove[];
  /** The item drilled, for the header's context line (R-224). */
  readonly item: HeaderItem | undefined;
  /**
   * The side asked to move: the asked position's, also while a wrong move
   * is held on the board (#381).
   */
  readonly toMove: BoardView['turnColor'];
}

/** Ends each flash after its time, unless a newer one took its place. */
function useUnflash<S extends Flashing>(
  flash: Flash | null,
  setState: Dispatch<SetStateAction<S>>,
): void {
  const unflash = useMemo(
    () => () => {
      setState((s) => (s.flash === flash ? { ...s, flash: null } : s));
    },
    [setState, flash],
  );
  useTimer(flash !== null, FEEDBACK_MS, unflash);
}

/**
 * The drill's board: the view of its position from the side of the
 * repertoire drilled (White without one), and each flash ended in time.
 */
export function useDrillBoard<S extends Flashing>(
  source: BoardSource<S>,
): DrillBoard {
  const { data, state, positionOf } = source;
  const position = useMemo(() => positionOf(state), [positionOf, state]);
  const { key } = position;
  const legal = useMemo(() => legalMoves(key), [key]);
  const entry = entryOf(data, source.repertoireOf(state));
  const side = entry?.side ?? 'white';
  const view = useMemo(
    () => drillBoard(position, side, legal),
    [position, side, legal],
  );
  useUnflash(state.flash, source.setState);
  return {
    view,
    legal,
    item: itemOf(entry, source.chapterOf(state)),
    toMove: colorToMove(key),
  };
}
