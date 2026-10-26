// The learn drill's state between the player's moves: the plan's lines, one
// after another, each in chess's learn session (its arrows round, then its
// blind round, R-144), the moves learned here with the Reviews they start
// (so the done summary shows them before the server has every result), and
// what the board shows meanwhile (a flash, a right move held, the opponent's
// move sliding in). Every rule is chess's; this only keeps their answers and
// draws them.
import {
  advanceLearn,
  currentLearnStep,
  newKeys,
  START_KEY,
  startLearnSession,
  startReview,
  type BoardMove,
  type LearnLine,
  type LearnPlanStep,
  type LearnSessionState,
  type LearnTransition,
  type RepertoireMove,
  type ReviewState,
} from '@mychess/chess';
import type { DrillPosition } from './drill-board';
import type { Flash } from './drill-input';

export interface LearnDrillState {
  readonly lines: readonly LearnLine[];
  /** The line being learned: an index into `lines`. */
  readonly at: number;
  /** That line's learn session; null when the plan has no line. */
  readonly session: LearnSessionState | null;
  /**
   * After a right move, the plies on the board while its flash shows: the
   * session has moved on, the board waits.
   */
  readonly hold: number | null;
  /** The last move was wrong (cleared by a right one). */
  readonly wrong: boolean;
  readonly flash: Flash | null;
  /** Bumped to put a refused piece back (BoardView.revision). */
  readonly revision: number;
  /** The last typed move was not a legal one. */
  readonly unknownTyped: boolean;
  /** The keys learned on this page, every session's, in order. */
  readonly learned: readonly string[];
  /** The player's Reviews, with one started for each key learned here. */
  readonly reviews: ReadonlyMap<string, ReviewState>;
}

/** A drill over `lines`, from the player's `reviews`. */
export function startLearnDrill(
  lines: readonly LearnLine[],
  reviews: ReadonlyMap<string, ReviewState>,
): LearnDrillState {
  const [first] = lines;
  return {
    lines,
    at: 0,
    session: first === undefined ? null : startLearnSession(first),
    hold: null,
    wrong: false,
    flash: null,
    revision: 0,
    unknownTyped: false,
    learned: [],
    reviews,
  };
}

/** The step the session waits on, unless the board holds a right move. */
const waitingOn = (s: LearnDrillState): LearnPlanStep | undefined =>
  s.session === null || s.hold !== null || s.session.done
    ? undefined
    : currentLearnStep(s.session);

export const isDone = (s: LearnDrillState): boolean =>
  s.session === null || (s.session.done && s.hold === null);

/** The opponent's move is on the board, sliding in: no move is taken yet. */
export const opponentMoving = (s: LearnDrillState): boolean =>
  waitingOn(s)?.kind === 'opponent';

/** Does the board take a move now? */
export function canPlay(s: LearnDrillState): boolean {
  const step = waitingOn(s);
  return step !== undefined && step.kind !== 'opponent';
}

/** The step the player is asked, if any: for the panel's words. */
export const askedStep = (s: LearnDrillState): LearnPlanStep | undefined =>
  canPlay(s) ? waitingOn(s) : undefined;

/** How many of the line's moves the board shows. */
function plies(s: LearnDrillState): number {
  if (s.session === null) return 0;
  if (s.hold !== null) return s.hold;
  if (s.session.done) return s.session.line.steps.length;
  return s.session.index + (opponentMoving(s) ? 1 : 0);
}

/** The moves on the board: the line so far. */
export function playedMoves(s: LearnDrillState): readonly RepertoireMove[] {
  const steps = s.session?.line.steps ?? [];
  return steps.slice(0, plies(s)).map((step) => step.move);
}

/** The position on the board, as a position key. */
export function shownKey(s: LearnDrillState): string {
  const root = s.session?.line.rootKey;
  return playedMoves(s).at(-1)?.to ?? root ?? START_KEY;
}

/** `learned` and `reviews` with `key` learned at `now`. */
function learnedAt(
  s: LearnDrillState,
  key: string,
  now: Date,
): Pick<LearnDrillState, 'learned' | 'reviews'> {
  return {
    learned: [...s.learned, key],
    reviews: new Map(s.reviews).set(key, startReview(key, now)),
  };
}

/** After the player's `move`: right, it is held and flashes; wrong, it goes back. */
export function afterPlay(
  s: LearnDrillState,
  move: BoardMove,
  played: LearnTransition,
  now: Date,
): LearnDrillState {
  const index = s.session?.index ?? 0;
  const { correct, emit } = played;
  return {
    ...s,
    ...(emit === null ? {} : learnedAt(s, emit.key, now)),
    session: played.state,
    hold: correct ? index + 1 : null,
    wrong: !correct,
    flash: { square: move.dest, kind: correct ? 'correct' : 'wrong' },
    revision: correct ? s.revision : s.revision + 1,
    unknownTyped: false,
  };
}

/** After the right move's flash: the session's next step, or the next line. */
export function released(s: LearnDrillState): LearnDrillState {
  const next = s.lines[s.at + 1];
  const ended = s.session?.done === true && next !== undefined;
  return {
    ...s,
    hold: null,
    flash: null,
    ...(ended ? { at: s.at + 1, session: startLearnSession(next) } : {}),
  };
}

/** After the opponent's move slid in: the player's step. */
export const advanced = (s: LearnDrillState): LearnDrillState =>
  s.session === null ? s : { ...s, session: advanceLearn(s.session) };

/** The new moves the plan teaches, and how many of them are learned. */
export function learnCounts(s: LearnDrillState): {
  readonly done: number;
  readonly total: number;
} {
  const planned = newKeys(s.lines);
  const learned = new Set(s.learned);
  return {
    done: planned.filter((key) => learned.has(key)).length,
    total: planned.length,
  };
}

/** The repertoire of the line on the board. */
export const repertoireOf = (s: LearnDrillState): string | undefined =>
  s.session?.line.repertoireId;

/**
 * What the board shows: the arrow of the move asked, while the session
 * shows it (R-144, R-55), and the answer's flash.
 */
export function positionOf(s: LearnDrillState): DrillPosition {
  const asked = askedStep(s)?.move.uci;
  return {
    key: shownKey(s),
    last: playedMoves(s).at(-1)?.uci,
    playable: canPlay(s),
    arrow: s.session?.arrow === true ? asked : undefined,
    flash: s.flash,
    revision: s.revision,
  };
}
