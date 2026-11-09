// The review drill's state between the player's answers: chess's review
// session (what is asked, what each answer means), the Reviews graded in
// the browser as the session goes (S6 decision 1), and what the board shows
// meanwhile (a flash, the reply sliding in). What each answer means is
// chess's; this keeps their answers, asks again the moves that come back
// today (R-78) and draws them.
import {
  grade,
  moveNumber,
  nextReview,
  reviewCounts,
  sideToMove,
  START_KEY,
  startReviewSession,
  type BoardMove,
  type QueueItem,
  type RepertoireMove,
  type ReviewEmit,
  type ReviewItemView,
  type ReviewSessionState,
  type ReviewState,
  type ReviewTransition,
  type TrainingRepertoire,
} from '@mychess/chess';
import type { SessionCounts } from './done-summary';
import type { DrillPosition } from './drill-board';
import type { Flash } from './drill-input';

/** How far a session goes: its size (R-62) and the player's day. */
export interface SessionBounds {
  /** Moves asked per session, the repeats of R-78 included. */
  readonly size: number;
  /** When the player's day ends: a move due before then comes back. */
  readonly dayEnd: Date;
}

export interface DrillState extends SessionBounds {
  /** The round being asked: chess's review session over its items. */
  readonly session: ReviewSessionState;
  /**
   * The rounds asked before it. The first asks the due moves; each later
   * one asks again the moves of the round before that come back today, as
   * a Lapse does within minutes, until none does (R-78).
   */
  readonly rounds: readonly ReviewSessionState[];
  /** The player's Reviews, graded as the session answers them. */
  readonly reviews: ReadonlyMap<string, ReviewState>;
  /** The item on the board: the asked one, or the last one once done. */
  readonly shown: ReviewItemView | null;
  /** The opponent's reply is sliding in; the board takes no move yet. */
  readonly replying: boolean;
  readonly flash: Flash | null;
  /** Bumped to put a refused piece back (BoardView.revision). */
  readonly revision: number;
  /** The last typed move was not a legal one. */
  readonly unknownTyped: boolean;
}

/** A session over `items`, from the player's `reviews`, at board revision 0. */
export function startDrill(
  items: readonly QueueItem[],
  repertoires: readonly TrainingRepertoire[],
  reviews: ReadonlyMap<string, ReviewState>,
  bounds: SessionBounds,
): DrillState {
  const session = startReviewSession(items, repertoires);
  return {
    ...bounds,
    session,
    rounds: [],
    reviews,
    shown: session.current,
    replying: false,
    flash: null,
    revision: 0,
    unknownTyped: false,
  };
}

/** `reviews` with the emitted outcome graded at `now`. */
function graded(
  reviews: ReadonlyMap<string, ReviewState>,
  emit: ReviewEmit | null,
  now: Date,
): ReadonlyMap<string, ReviewState> {
  const review = emit === null ? undefined : reviews.get(emit.key);
  if (emit === null || review === undefined) return reviews;
  return new Map(reviews).set(emit.key, grade(review, emit.outcome, now));
}

/**
 * After the player's `move`: right, it stays and flashes; wrong, it goes
 * back. A move typed during the reply's slide ends the slide.
 */
export function afterAnswer(
  s: DrillState,
  move: BoardMove,
  answer: ReviewTransition,
  now: Date,
): DrillState {
  const right = answer.state.phase === 'correct';
  return {
    ...s,
    session: answer.state,
    reviews: graded(s.reviews, answer.emit, now),
    replying: false,
    flash: { square: move.dest, kind: right ? 'correct' : 'wrong' },
    revision: right ? s.revision : s.revision + 1,
    unknownTyped: false,
  };
}

/** After the hint button: the piece is shown, the hint graded. */
export function afterHint(
  s: DrillState,
  hint: ReviewTransition,
  now: Date,
): DrillState {
  return {
    ...s,
    session: hint.state,
    reviews: graded(s.reviews, hint.emit, now),
  };
}

/** Is `key`'s graded Review due again before the player's day ends? */
function dueToday(s: DrillState, key: string): boolean {
  const due = s.reviews.get(key)?.fsrs.due;
  return due !== undefined && due.getTime() < s.dayEnd.getTime();
}

/** The round's answered items that come back today, in its order (R-78). */
const comingBack = (s: DrillState): QueueItem[] =>
  s.session.order.filter(
    (i) => s.session.outcomes.has(i.key) && dueToday(s, i.key),
  );

/**
 * The round's items still to ask. A repeat round asks all of its own; the
 * first stops where the session size is reached, the repeats counted in
 * (R-62, R-78), and leaves the rest due for "continue".
 */
function stillAsked(s: DrillState): number {
  const { order, outcomes } = s.session;
  const open = order.length - outcomes.size;
  if (isRepeat(s)) return open;
  const room = s.size - outcomes.size - comingBack(s).length;
  return Math.min(open, Math.max(0, room));
}

/** The next round over what comes back today, or the session done. */
function nextRound(
  s: DrillState,
  repertoires: readonly TrainingRepertoire[],
): DrillState {
  const back = comingBack(s);
  if (back.length === 0)
    return { ...s, session: { ...s.session, current: null } };
  return {
    ...s,
    rounds: [...s.rounds, s.session],
    session: startReviewSession(back, repertoires),
  };
}

/**
 * After the correct flash: the chained item (its reply first), or the next;
 * once the round is over, the moves that come back today.
 */
export function advanced(
  s: DrillState,
  repertoires: readonly TrainingRepertoire[],
): DrillState {
  const next = { ...s, session: nextReview(s.session, repertoires) };
  const asks = next.session.current !== null && stillAsked(next) > 0;
  const moved = asks ? next : nextRound(next, repertoires);
  const { current } = moved.session;
  return {
    ...moved,
    shown: current ?? s.shown,
    replying: (current?.reply ?? null) !== null,
    flash: null,
  };
}

export const isDone = (s: DrillState): boolean => s.session.current === null;

/** Is the drill asking again a move answered earlier in the session (R-78)? */
export const isRepeat = (s: DrillState): boolean => s.rounds.length > 0;

/** Every answer of the session so far, and how many it will take in all. */
export function sessionProgress(s: DrillState): {
  readonly done: number;
  readonly total: number;
} {
  const before = s.rounds.reduce((n, r) => n + r.outcomes.size, 0);
  const done = before + s.session.outcomes.size;
  return { done, total: done + stillAsked(s) + comingBack(s).length };
}

/** Does the move field take a move now? Also while the reply slides in (#324). */
export const canType = (s: DrillState): boolean =>
  !isDone(s) && s.session.phase !== 'correct';

/** Does the board take a move now? */
export const canPlay = (s: DrillState): boolean => canType(s) && !s.replying;

/** Can a hint still be asked for the current item (R-61)? */
export const canHint = (s: DrillState): boolean => {
  const key = s.session.current?.item.key;
  return canPlay(s) && key !== undefined && !s.session.outcomes.has(key);
};

/**
 * The asked move once it is answered, right or after a Lapse's arrow: where
 * its Coach note shows (R-174), never before, so it gives nothing away.
 */
export const answeredMove = (s: DrillState): RepertoireMove | undefined =>
  isDone(s) || s.session.phase === 'ask'
    ? undefined
    : s.shown?.line.moves.at(-1);

/** The moves on the board: the line so far, with the asked one once it is played. */
export function playedMoves(s: DrillState): readonly RepertoireMove[] {
  const moves = s.shown?.line.moves ?? [];
  const played = isDone(s) || s.session.phase === 'correct';
  return played ? moves : moves.slice(0, -1);
}

/** The position on the board. */
export const shownKey = (s: DrillState): string =>
  playedMoves(s).at(-1)?.to ?? s.shown?.line.rootKey ?? START_KEY;

/**
 * What the board shows: the expected move as an arrow after a Lapse (R-59),
 * its piece once hinted (R-61), and the answer's flash.
 */
export function positionOf(s: DrillState): DrillPosition {
  const expected = isDone(s) ? undefined : s.shown?.line.moves.at(-1)?.uci;
  const { phase, hinted } = s.session;
  return {
    key: shownKey(s),
    last: playedMoves(s).at(-1)?.uci,
    playable: canPlay(s),
    arrow: phase === 'replay' ? expected : undefined,
    hint: hinted && phase !== 'correct' ? expected : undefined,
    flash: s.flash,
    revision: s.revision,
  };
}

/** The repertoire of the item on the board. */
export const repertoireOf = (s: DrillState): string | undefined =>
  s.shown?.item.repertoireId;

/**
 * What the session did, for the done summary: the moves of its first round,
 * each by its first answer; the repeats change none of them.
 */
export function sessionCounts(s: DrillState): SessionCounts {
  const { done, passed, lapses } = reviewCounts(s.rounds[0] ?? s.session);
  return { kind: 'review', reviewed: done, passed, lapses };
}

/** The opponent's reply before the asked move, numbered: `1... d5`. */
export function replyText(view: ReviewItemView): string | null {
  const { moves, rootKey } = view.line;
  const ply = moves.length - 2;
  if (view.reply === null || ply < 0) return null;
  const whiteFirst = sideToMove(rootKey) === 'w';
  return `${moveNumber(ply, whiteFirst)} ${view.reply.san}`;
}
