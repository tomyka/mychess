// The state both drills keep beside their session (#384): the answer's
// flash, the board's revision that puts a refused piece back, whether the
// last typed move was unknown, and the player's Reviews as the drill
// changes them; and a step's result to record (R-60). Each drill's state
// extends this with its session; the drill hook (use-drill) runs both.
import type { BoardMove, ReviewState } from '@mychess/chess';
import type { TrainingResult } from '@mychess/domain';
import { answerFlash, type Marks } from './drill-frame';

export interface DrillCore extends Marks {
  /** The last typed move was not a legal one. */
  readonly unknownTyped: boolean;
  /** The player's Reviews, as the drill grades or starts them. */
  readonly reviews: ReadonlyMap<string, ReviewState>;
}

/** The core of a drill starting from the player's `reviews`, at board revision 0. */
export const startCore = (
  reviews: ReadonlyMap<string, ReviewState>,
): DrillCore => ({ flash: null, revision: 0, unknownTyped: false, reviews });

/**
 * The marks after the player's `move` from `key`: right, it stays and
 * flashes; wrong, it is held for its flash, then goes back (#381). Either
 * way the unknown typed move is forgotten.
 */
export const answerMarks = (
  s: DrillCore,
  key: string,
  move: BoardMove,
  right: boolean,
): Pick<DrillCore, 'flash' | 'revision' | 'unknownTyped'> => ({
  flash: answerFlash(key, move, right),
  revision: right ? s.revision : s.revision + 1,
  unknownTyped: false,
});

/** Puts a refused piece back on its square. */
export const putBack = <S extends DrillCore>(s: S): S => ({
  ...s,
  revision: s.revision + 1,
});

/** The typed move is not a legal one. */
export const typedUnknown = <S extends DrillCore>(s: S): S => ({
  ...s,
  unknownTyped: true,
});

/** What a step leaves to record: the result without its id and time. */
export type DrillResult = Omit<TrainingResult, 'resultId' | 'answeredAt'>;

/** A step of the drill: its next state, and the result it leaves, if any. */
export interface Step<S> {
  readonly state: S;
  readonly result: DrillResult | null;
}
