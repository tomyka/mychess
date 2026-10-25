'use client';

// What both drills share between the board and their state: the clock that
// stamps each result, the timer that runs their timed steps, and the way a
// move reaches them from the board, the move field or the promotion choice.
import type { Key } from '@lichess-org/chessground/types';
import { findLegalMove, type BoardMove, type Promotion } from '@mychess/chess';
import { useEffect, useState } from 'react';
import { movesBetween } from '../repertoire-view';

/** The `duration-feedback` token (tokens.css): a square's answer flash. */
export const FEEDBACK_MS = 400;

/** A square's answer flash (docs/design/training-screen.md, Move feedback). */
export interface Flash {
  readonly square: string;
  readonly kind: 'correct' | 'wrong';
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
  /** Does the drill take a move now? */
  readonly canPlay: boolean;
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
      if (!taker.canPlay) return false;
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
