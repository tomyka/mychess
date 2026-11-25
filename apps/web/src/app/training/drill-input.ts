'use client';

// What both drills share between the board and their state: the clock that
// stamps each result, the timer that runs their timed steps, and the way a
// move reaches them from the board, the move field or the promotion choice.
import type { Key } from '@lichess-org/chessground/types';
import {
  findLegalMove,
  positionAfterMove,
  type BoardMove,
  type Promotion,
} from '@mychess/chess';
import { useEffect, useState } from 'react';
import { movesBetween } from '../repertoire-view';

/** The `duration-feedback` token (tokens.css): an answer's flash, and a wrong move's hold. */
export const FEEDBACK_MS = 700;

/** A square's answer flash (docs/design/training-screen.md, Move feedback). */
export interface Flash {
  readonly square: string;
  readonly kind: 'correct' | 'wrong';
  /** A wrong move, held on the board while its flash shows (#381). */
  readonly after?: { readonly key: string; readonly uci: string };
}

/** Is a wrong move held on the board now? No move is taken meanwhile. */
export const holdsWrong = (flash: Flash | null): boolean =>
  flash?.kind === 'wrong' && flash.after !== undefined;

/** The flash of the player's `move` from `key`: a wrong one holds its position. */
export function answerFlash(
  key: string,
  move: BoardMove,
  right: boolean,
): Flash {
  if (right) return { square: move.dest, kind: 'correct' };
  const uci = `${move.orig}${move.dest}${move.promotion ?? ''}`;
  const after = { key: positionAfterMove(key, move), uci };
  return { square: move.dest, kind: 'wrong', after };
}

/** The drill's time and result ids, so a test can fix them. */
export interface DrillClock {
  now(): Date;
  newId(): string;
}

export const BROWSER_CLOCK: DrillClock = {
  now: () => new Date(),
  newId: () => crypto.randomUUID(),
};

/** Runs `step` after `ms` while `on` holds; a change of `on` or `step` resets it. */
export function useTimer(on: boolean, ms: number, step: () => void): void {
  useEffect(() => {
    if (!on) return undefined;
    const timer = setTimeout(step, ms);
    return () => {
      clearTimeout(timer);
    };
  }, [on, ms, step]);
}

/** A move from the board, the move field or the promotion choice. */
export interface MoveInput {
  /** A pawn's move to the last rank, waiting for its piece. */
  readonly promotion: readonly BoardMove[] | null;
  readonly onMove: (orig: Key, dest: Key) => void;
  /** Whether the typed move was taken (the field clears only then). */
  readonly onTyped: (text: string) => boolean;
  readonly pick: (piece: Promotion) => void;
  readonly cancel: () => void;
}

/** Where the moves go: the drill's position and what it does with a move. */
export interface MoveTaker {
  /** The position on the board, as a position key. */
  readonly position: string;
  /** Its legal moves. */
  readonly legal: readonly BoardMove[];
  /** Does the drill take a move from the board now? */
  readonly canPlay: boolean;
  /**
   * Does it take a typed move now? Also while the opponent's move still
   * slides in: the position is the player's already, and a move typed the
   * moment the reply shows must not be lost (#324). Only the board waits,
   * so a drag does not fight the slide.
   */
  readonly canType: boolean;
  readonly play: (move: BoardMove) => void;
  /** Puts a refused piece back on its square. */
  readonly putBack: () => void;
  /** The typed move is not a legal one. */
  readonly unknown: () => void;
}

/** The drill's move input over `taker`, a promotion waiting for its piece. */
export function useMoveInput(taker: MoveTaker): MoveInput {
  const [promotion, setPromotion] = useState<readonly BoardMove[] | null>(null);
  return {
    promotion,
    onMove(orig, dest) {
      const options = movesBetween(taker.legal, orig, dest);
      const [only] = options;
      if (options.length > 1) setPromotion(options);
      else if (only !== undefined && taker.canPlay) taker.play(only);
      else taker.putBack();
    },
    onTyped(text) {
      if (!taker.canType) return false;
      const move = findLegalMove(taker.position, text);
      if (move === null) taker.unknown();
      else taker.play(move);
      return move !== null;
    },
    pick(piece) {
      const move = promotion?.find((m) => m.promotion === piece);
      setPromotion(null);
      if (move !== undefined) taker.play(move);
    },
    cancel() {
      setPromotion(null);
      taker.putBack();
    },
  };
}
