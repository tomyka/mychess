// The review drill's state between the player's answers: chess's review
// session (what is asked, what each answer means), the Reviews graded in
// the browser as the session goes (S6 decision 1), and what the board shows
// meanwhile (a flash, the reply sliding in). What each answer means, and
// when a move comes back today (R-78), is chess's; this keeps the answers
// and draws them.
import {
  moveNumber,
  nextReview,
  reviewCounts,
  sideToMove,
  startReviewSession,
  type BoardMove,
  type QueueItem,
  type RepertoireMove,
  type ReviewBounds,
  type ReviewEmit,
  type ReviewItemView,
  type ReviewSessionState,
  type ReviewState,
  type ReviewTransition,
  type TrainingRepertoire,
} from '@mychess/chess';
import type { SessionCounts } from './done-summary';
import { answerMarks, startCore, type DrillCore } from './drill-core';
import {
  drillFrame,
  lineEnd,
  type Asked,
  type DrillFrame,
} from './drill-frame';
import type { ItemIds } from './session-header';

/** The review drill's state; its `reviews` are graded as the session answers them. */
export interface ReviewDrillState extends DrillCore {
  /** Chess's review session: what is asked, its repeats included (R-78). */
  readonly session: ReviewSessionState;
  /** The item on the board: the asked one, or the last one once done. */
  readonly shown: ReviewItemView | null;
  /** The opponent's reply is sliding in; the board takes no move yet. */
  readonly replying: boolean;
}

/** A session over `items`, from the player's `reviews`, at board revision 0. */
export function startReviewDrill(
  items: readonly QueueItem[],
  repertoires: readonly TrainingRepertoire[],
  reviews: ReadonlyMap<string, ReviewState>,
  bounds: ReviewBounds,
): ReviewDrillState {
  const session = startReviewSession(items, repertoires, bounds);
  return {
    ...startCore(reviews),
    session,
    shown: session.current,
    replying: false,
  };
}

/** `reviews` with the Review the emitted outcome graded (chess grades it). */
function graded(
  reviews: ReadonlyMap<string, ReviewState>,
  emit: ReviewEmit | null,
): ReadonlyMap<string, ReviewState> {
  const review = emit?.review ?? null;
  if (emit === null || review === null) return reviews;
  return new Map(reviews).set(emit.key, review);
}

/**
 * After the player's `move`: right, it stays and flashes; wrong, it is
 * held for its flash, then goes back (#381). A move typed during the
 * reply's slide ends the slide.
 */
export function afterAnswer(
  s: ReviewDrillState,
  move: BoardMove,
  answer: ReviewTransition,
): ReviewDrillState {
  const right = answer.state.phase === 'correct';
  return {
    ...s,
    ...answerMarks(s, shownKey(s), move, right),
    session: answer.state,
    reviews: graded(s.reviews, answer.emit),
    replying: false,
  };
}

/** After the hint button: the piece is shown, the hint graded. */
export function afterHint(
  s: ReviewDrillState,
  hint: ReviewTransition,
): ReviewDrillState {
  return {
    ...s,
    session: hint.state,
    reviews: graded(s.reviews, hint.emit),
  };
}

/**
 * After the correct flash, or Next, at `now`: the chained item (its reply first), a
 * move whose relearning step has run out (R-78), or the next due one.
 */
export function released(
  s: ReviewDrillState,
  repertoires: readonly TrainingRepertoire[],
  now: Date,
): ReviewDrillState {
  const session = nextReview(s.session, repertoires, now);
  const { current } = session;
  return {
    ...s,
    session,
    shown: current ?? s.shown,
    replying: (current?.reply ?? null) !== null,
    flash: null,
  };
}

/** After the opponent's reply slid in: the board takes the player's move. */
export const advanced = (s: ReviewDrillState): ReviewDrillState => ({
  ...s,
  replying: false,
});

export const isDone = (s: ReviewDrillState): boolean =>
  s.session.current === null;

/** Is the drill asking again a move answered earlier in the session (R-78)? */
export const isRepeat = (s: ReviewDrillState): boolean =>
  s.session.current?.repeat === true;

/**
 * Is a move asked, so the move field takes one? Also while the reply
 * slides in (#324).
 */
const asking = (s: ReviewDrillState): boolean =>
  !isDone(s) && s.session.phase !== 'correct';

/**
 * The asked move once it is answered, right or after a Lapse's arrow: where
 * its Coach note shows (R-174), never before, so it gives nothing away.
 */
export const answeredMove = (
  s: ReviewDrillState,
): RepertoireMove | undefined =>
  isDone(s) || s.session.phase === 'ask'
    ? undefined
    : s.shown?.line.moves.at(-1);

/** The moves on the board: the line so far, with the asked one once it is played. */
export function playedMoves(s: ReviewDrillState): readonly RepertoireMove[] {
  const moves = s.shown?.line.moves ?? [];
  const played = isDone(s) || s.session.phase === 'correct';
  return played ? moves : moves.slice(0, -1);
}

/** The position on the board, and the move that led to it. */
const shownEnd = (s: ReviewDrillState): Pick<Asked, 'key' | 'last'> =>
  lineEnd(playedMoves(s), s.shown?.line.rootKey);

/** The position on the board. */
export const shownKey = (s: ReviewDrillState): string => shownEnd(s).key;

/** The item asked: its repertoire and chapter. */
const itemIds = (s: ReviewDrillState): ItemIds => ({
  repertoireId: s.shown?.item.repertoireId,
  chapterId: s.shown?.line.chapterId,
});

/**
 * What the drill asks: the expected move as an arrow after a Lapse (R-59),
 * its piece once hinted (R-61); the board waits for the reply's slide.
 */
function askedOf(s: ReviewDrillState): Asked {
  const expected = isDone(s) ? undefined : s.shown?.line.moves.at(-1)?.uci;
  const { phase, hinted } = s.session;
  return {
    ...itemIds(s),
    ...shownEnd(s),
    playable: asking(s) && !s.replying,
    typeable: asking(s),
    arrow: phase === 'replay' ? expected : undefined,
    hint: hinted && phase !== 'correct' ? expected : undefined,
  };
}

/** What the drill shows now, a wrong move held in place of the asked position (#381). */
export const frameOf = (s: ReviewDrillState): DrillFrame =>
  drillFrame(askedOf(s), s);

/** Can a hint still be asked for the current item (R-61)? */
export const canHint = (s: ReviewDrillState): boolean =>
  frameOf(s).playable && !s.session.recorded;

/**
 * What the session did, for the done summary: its moves, each by its first
 * answer; the repeats change none of them.
 */
export function sessionCounts(s: ReviewDrillState): SessionCounts {
  const { done, passed, lapses } = reviewCounts(s.session);
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
