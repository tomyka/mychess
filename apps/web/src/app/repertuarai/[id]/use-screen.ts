'use client';

// The repertoire page's hooks: the board's view of the screen state, what a
// move played on the board or typed does while browsing.
import type { Key } from '@lichess-org/chessground/types';
import {
  fenOf,
  findLegalMove,
  inCheck,
  legalMoves,
  sideToMove,
  START_KEY,
  type BoardMove,
  type Promotion,
  type Side,
} from '@mychess/chess';
import { useMemo, useState, type ActionDispatch } from 'react';
import type { BoardView } from '../../board/board-config';
import { shapesOf } from '../../board/shapes';
import { destsOf, isKey, squaresOf } from '../../board/squares';
import { childBySan, movesBetween } from './board-play';
import {
  currentKey,
  type ScreenAction,
  type ScreenMessage,
  type ScreenState,
} from './screen-state';

type Dispatch = ActionDispatch<[action: ScreenAction]>;

export interface ScreenBoard {
  /** The shown position (the standard start in a repertoire without chapters). */
  readonly key: string;
  readonly legal: readonly BoardMove[];
  readonly view: BoardView;
}

const NO_DESTS: ReadonlyMap<Key, readonly Key[]> = new Map();

/**
 * Whether the board takes a move: never while saving or in draw mode; in
 * builder mode not once the repertoire changed elsewhere; and without a
 * chapter only in builder mode, where the first move starts one (R-111).
 */
function canPlay(state: ScreenState): boolean {
  if (state.saving || state.drawMode) return false;
  const building = state.mode === 'build';
  if (building && state.stale) return false;
  return state.chapterId !== null || building;
}

/** Whether the current move's marks can be changed now (builder, on a move). */
export function canMark(state: ScreenState): boolean {
  return (
    state.mode === 'build' &&
    state.path.length > 0 &&
    !state.saving &&
    !state.stale
  );
}

/** What the board shows for the screen state. */
export function useScreenBoard(state: ScreenState, side: Side): ScreenBoard {
  const key = currentKey(state) ?? START_KEY;
  const legal = useMemo(() => legalMoves(key), [key]);
  const movable = canPlay(state);
  const marking = canMark(state);
  const last = state.path.at(-1);
  const { revision, drawMode, drawFrom } = state;
  const view = useMemo((): BoardView => {
    const shapes = last === undefined ? [] : shapesOf(last);
    return {
      fen: fenOf(key),
      orientation: side,
      turnColor: sideToMove(key) === 'w' ? 'white' : 'black',
      check: inCheck(key),
      lastMove: last === undefined ? [] : squaresOf(last.uci),
      dests: movable ? destsOf(legal) : NO_DESTS,
      shapes: marking ? shapes : [],
      autoShapes: marking ? [] : shapes,
      drawing: marking,
      picking: drawMode,
      picked: drawFrom !== null && isKey(drawFrom) ? drawFrom : null,
      revision,
    };
  }, [key, side, last, movable, marking, legal, drawMode, drawFrom, revision]);
  return { key, legal, view };
}

/** A pawn's move to the last rank, waiting for the piece it becomes. */
interface PendingPromotion {
  readonly options: readonly BoardMove[];
}

/** What the board does with moves played on the board or typed. */
export interface BoardPlay {
  readonly promotion: PendingPromotion | null;
  readonly onMove: (orig: Key, dest: Key) => void;
  /** Whether the typed move was taken (the field clears only then). */
  readonly onTyped: (text: string) => boolean;
  readonly pick: (piece: Promotion) => void;
  readonly cancel: () => void;
}

const say = (message: ScreenMessage): ScreenAction => ({
  type: 'say',
  message,
});

/**
 * A move the chapter has at this position goes to it. Any other move is
 * `addNew`'s (builder mode); without it, browsing says the move is not in
 * the chapter and the piece goes back (docs/design/repertoire-screen.md).
 */
export function useBoardPlay(
  state: ScreenState,
  dispatch: Dispatch,
  board: ScreenBoard,
  addNew: ((san: string) => void) | null,
): BoardPlay {
  const [promotion, setPromotion] = useState<PendingPromotion | null>(null);

  function goTo(san: string): boolean {
    const move =
      state.chapterId === null
        ? undefined
        : childBySan(state.graph, state.chapterId, board.key, san);
    if (move !== undefined) {
      dispatch({ type: 'goto', path: [...state.path, move] });
      dispatch({ type: 'say', message: null });
      return true;
    }
    if (addNew !== null && san !== '') {
      addNew(san);
      return true;
    }
    dispatch(say({ key: 'repertoires.board.notInRepertoire', tone: 'info' }));
    dispatch({ type: 'reset' });
    return false;
  }

  return {
    promotion,
    onMove(orig: Key, dest: Key): void {
      const options = movesBetween(board.legal, orig, dest);
      if (options.length > 1) setPromotion({ options });
      else goTo(options[0]?.san ?? '');
    },
    onTyped(text: string): boolean {
      const move = findLegalMove(board.key, text);
      if (move !== null) return goTo(move.san);
      dispatch(say({ key: 'board.moveInput.unknown', tone: 'error' }));
      return false;
    },
    pick(piece: Promotion): void {
      setPromotion(null);
      goTo(promotion?.options.find((m) => m.promotion === piece)?.san ?? '');
    },
    cancel(): void {
      setPromotion(null);
      dispatch({ type: 'reset' });
    },
  };
}
