// The review drill's state between the player's answers: chess's review
// session (what is asked, what each answer means), the Reviews graded in
// the browser as the session goes (S6 decision 1), and what the board shows
// meanwhile (a flash, the reply sliding in). Every rule is chess's; this
// only keeps their answers and draws them.
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

export interface DrillState {
  readonly session: ReviewSessionState;
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

/** A session over `items`, from the player's `reviews`. */
export function startDrill(
  items: readonly QueueItem[],
  repertoires: readonly TrainingRepertoire[],
  reviews: ReadonlyMap<string, ReviewState>,
  revision: number,
): DrillState {
  const session = startReviewSession(items, repertoires);
  return {
    session,
    reviews,
    shown: session.current,
    replying: false,
    flash: null,
    revision,
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

/** After the player's `move`: right, it stays and flashes; wrong, it goes back. */
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

/** After the correct flash: the chained item (its reply first), or the next. */
export function advanced(
  s: DrillState,
  repertoires: readonly TrainingRepertoire[],
): DrillState {
  const session = nextReview(s.session, repertoires);
  return {
    ...s,
    session,
    shown: session.current ?? s.shown,
    replying: (session.current?.reply ?? null) !== null,
    flash: null,
  };
}

export const isDone = (s: DrillState): boolean => s.session.current === null;

/** Does the board take a move now? */
export const canPlay = (s: DrillState): boolean =>
  !isDone(s) && s.session.phase !== 'correct' && !s.replying;

/** Can a hint still be asked for the current item (R-61)? */
export const canHint = (s: DrillState): boolean => {
  const key = s.session.current?.item.key;
  return canPlay(s) && key !== undefined && !s.session.outcomes.has(key);
};

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

/** What the session did, for the done summary. */
export function sessionCounts(session: ReviewSessionState): SessionCounts {
  const { done, passed, lapses } = reviewCounts(session);
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
