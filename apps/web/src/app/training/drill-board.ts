'use client';

// The board adapter of both drills: it draws the drill's frame (drill-frame)
// from the side of the repertoire drilled, the position with its arrow, the
// hint's piece and the answer's flash.
// What is shown, and whether a move is taken, is the frame's.
import type { DrawShape } from '@lichess-org/chessground/draw';
import type { Key } from '@lichess-org/chessground/types';
import {
  fenOf,
  inCheck,
  legalMoves,
  type BoardMove,
  type Side,
} from '@mychess/chess';
import { useMemo } from 'react';
import type { TrainingData } from '../../lib/training-data';
import type { BoardView } from '../board/board-config';
import { destsOf, isKey, squaresOf } from '../board/squares';
import { colorToMove, type DrillFrame } from './drill-frame';

function arrowsOf(f: DrillFrame): DrawShape[] {
  const [orig, dest] = f.arrow === undefined ? [] : squaresOf(f.arrow);
  if (orig === undefined || dest === undefined) return [];
  return [{ orig, dest, brush: 'arrow' }];
}

/** The hint's piece and the answer's flash, as square classes. */
function markedOf(f: DrillFrame): Map<Key, string> {
  const marked = new Map<Key, string>();
  const [from] = f.hint === undefined ? [] : squaresOf(f.hint);
  if (from !== undefined) marked.set(from, 'hint');
  const { flash } = f;
  if (flash !== null && isKey(flash.square))
    marked.set(flash.square, flash.kind);
  return marked;
}

const NO_DESTS: ReadonlyMap<Key, readonly Key[]> = new Map();

/**
 * `frame` drawn from `side`, with the asked position's `legal` moves taken
 * while the frame takes a move.
 */
export function drillBoard(
  frame: DrillFrame,
  side: Side,
  legal: readonly BoardMove[],
): BoardView {
  return {
    fen: fenOf(frame.key),
    orientation: side,
    turnColor: colorToMove(frame.key),
    check: inCheck(frame.key),
    lastMove: frame.last === undefined ? [] : squaresOf(frame.last),
    dests: frame.playable ? destsOf(legal) : NO_DESTS,
    shapes: [],
    autoShapes: arrowsOf(frame),
    drawing: false,
    picking: false,
    picked: null,
    revision: frame.revision,
    marked: markedOf(frame),
  };
}

export interface DrillBoard {
  readonly view: BoardView;
  /** The legal moves of the asked position. */
  readonly legal: readonly BoardMove[];
}

/**
 * The board of `frame`: drawn from the side of the repertoire drilled
 * (White without one), kept while the frame is the same.
 */
export function useDrillBoard(
  data: TrainingData,
  frame: DrillFrame,
): DrillBoard {
  const { asked, repertoireId } = frame;
  const legal = useMemo(() => legalMoves(asked), [asked]);
  const side = data.entries.find((e) => e.id === repertoireId)?.side ?? 'white';
  const view = useMemo(
    () => drillBoard(frame, side, legal),
    [frame, side, legal],
  );
  return { view, legal };
}
