'use client';

// The repertoire page's hooks: the board's view of the screen state, what a
// move played on the board or typed does while browsing, and the viewer's
// Personal notes.
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
import { destsOf, squaresOf } from '../../board/squares';
import { savePersonalNoteAction, type NoteOutcome } from './actions';
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

/** What the board shows for the screen state. */
export function useScreenBoard(state: ScreenState, side: Side): ScreenBoard {
  const key = currentKey(state) ?? START_KEY;
  const legal = useMemo(() => legalMoves(key), [key]);
  const movable = state.chapterId !== null && !state.saving && !state.drawMode;
  const last = state.path.at(-1);
  const { revision } = state;
  const view = useMemo(
    (): BoardView => ({
      fen: fenOf(key),
      orientation: side,
      turnColor: sideToMove(key) === 'w' ? 'white' : 'black',
      check: inCheck(key),
      lastMove: last === undefined ? [] : squaresOf(last.uci),
      dests: movable ? destsOf(legal) : NO_DESTS,
      shapes: [],
      autoShapes: last === undefined ? [] : shapesOf(last),
      drawing: false,
      revision,
    }),
    [key, side, last, movable, legal, revision],
  );
  return { key, legal, view };
}

/** A pawn's move to the last rank, waiting for the piece it becomes. */
interface PendingPromotion {
  readonly options: readonly BoardMove[];
}

/** What browsing does with moves played on the board or typed. */
export interface BrowsePlay {
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
 * Browsing: a move the chapter has at this position goes to it; any other
 * says so and the piece goes back (docs/design/repertoire-screen.md).
 */
export function useBrowsePlay(
  state: ScreenState,
  dispatch: Dispatch,
  board: ScreenBoard,
): BrowsePlay {
  const [promotion, setPromotion] = useState<PendingPromotion | null>(null);

  function goTo(san: string): boolean {
    const move =
      state.chapterId === null
        ? undefined
        : childBySan(state.graph, state.chapterId, board.key, san);
    if (move === undefined) {
      dispatch(say({ key: 'repertoires.board.notInRepertoire', tone: 'info' }));
      dispatch({ type: 'reset' });
      return false;
    }
    dispatch({ type: 'goto', path: [...state.path, move] });
    dispatch({ type: 'say', message: null });
    return true;
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

/** `notes` with the note on `key` set, or removed when `text` is empty. */
function withNote(
  notes: Readonly<Record<string, string>>,
  key: string,
  text: string,
): Record<string, string> {
  const next = Object.fromEntries(
    Object.entries(notes).filter(([k]) => k !== key),
  );
  return text === '' ? next : { ...next, [key]: text };
}

/** The viewer's notes, and a saver for the note on one move. */
export interface Notes {
  readonly notes: Readonly<Record<string, string>>;
  readonly save: (moveKey: string) => (text: string) => Promise<NoteOutcome>;
}

/** The viewer's Personal notes, saved through the action (R-21). */
export function useNotes(
  repertoireId: string,
  initial: Readonly<Record<string, string>>,
): Notes {
  const [notes, setNotes] = useState(initial);
  return {
    notes,
    save:
      (moveKey: string) =>
      async (text: string): Promise<NoteOutcome> => {
        const outcome = await savePersonalNoteAction({
          repertoireId,
          moveKey,
          text,
        });
        if (outcome.ok) setNotes((now) => withNote(now, moveKey, text.trim()));
        return outcome;
      },
  };
}
