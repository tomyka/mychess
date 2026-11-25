/**
 * The review session (R-143, R-59, R-61, R-78): the queue's Due Reviews asked
 * one at a time, each after its line so far. After a right answer the
 * session chains into the opponent's reply and a Due move that follows it,
 * so the player plays on in the line; otherwise it jumps to the next item.
 * Each ask emits one outcome, the first of a hint, a Lapse or a pass, for
 * the caller to grade; replaying the move after a Lapse records nothing.
 * A move whose Review, so graded, comes due again before the player's day
 * ends (a Lapse's relearning step, R-78) is asked again once that step runs
 * out, on top of the session size, which counts moves (R-223).
 */
import {
  isPlayerMove,
  moveKey,
  type RepertoireMove,
} from '../repertoire/graph';
import { chapterChildren } from '../repertoire/walk';
import { linesTo, type LineTo } from './line-to';
import type { QueueItem } from './queue';
import {
  grade,
  inShortTermStep,
  type Outcome,
  type ReviewState,
} from './schedule';
import type { TrainingRepertoire } from './scope';

/** `replay`: after a Lapse, the arrow is shown until the move is played. */
export type ReviewPhase = 'ask' | 'replay' | 'correct';

export interface ReviewItemView {
  readonly item: QueueItem;
  /** From the chapter's root; the asked move is last. */
  readonly line: LineTo;
  /** The chained opponent reply, shown before asking. */
  readonly reply: RepertoireMove | null;
  /** A move answered earlier in the session, asked again (R-78). */
  readonly repeat: boolean;
}

/** R-78: a move answered this session that comes back today, and when. */
export interface Repeat {
  readonly item: QueueItem;
  readonly due: Date;
}

/** How far a session goes. */
export interface ReviewBounds {
  /** R-62, R-223: the moves the session asks; repeats (R-78) come on top. */
  readonly size: number;
  /** When the player's day ends: a move due again before then comes back. */
  readonly dayEnd: Date;
}

/**
 * An answer's time and the player's Reviews before it: the session grades
 * the answer as the caller will, to know when the move comes back (R-78).
 */
export interface ReviewClock {
  readonly now: Date;
  readonly reviews: ReadonlyMap<string, ReviewState>;
}

export interface ReviewSessionState extends ReviewBounds {
  /** The items asked once each: the first asks. */
  readonly order: readonly QueueItem[];
  /** Each item's first outcome; a repeat changes none. */
  readonly outcomes: ReadonlyMap<string, Outcome>;
  /** Null when the session is over. */
  readonly current: ReviewItemView | null;
  readonly phase: ReviewPhase;
  readonly hinted: boolean;
  /** The current ask has emitted its outcome. */
  readonly recorded: boolean;
  /** Answers given so far, repeats included. */
  readonly asked: number;
  /**
   * Repeats still to ask, the earliest due first: the current move's own
   * once it is answered, never the one being asked.
   */
  readonly repeats: readonly Repeat[];
}

export interface ReviewEmit {
  readonly key: string;
  readonly repertoireId: string;
  readonly outcome: Outcome;
  /**
   * The move's Review graded with the outcome at the answer's time, for the
   * caller to keep; null when the player has no Review of the move.
   */
  readonly review: ReviewState | null;
}

export interface ReviewTransition {
  readonly state: ReviewSessionState;
  readonly emit: ReviewEmit | null;
}

/** Items answered, of the items the session holds, and how they went. */
export interface ReviewCounts {
  readonly done: number;
  readonly total: number;
  /** Answered right first time. */
  readonly passed: number;
  /** A wrong answer or a hint (R-61). */
  readonly lapses: number;
}

/** The items' first answers; the repeats change none of them. */
export function reviewCounts(s: ReviewSessionState): ReviewCounts {
  const done = s.outcomes.size;
  const passed = [...s.outcomes.values()].filter((o) => o === 'pass').length;
  return { done, total: s.order.length, passed, lapses: done - passed };
}

/** Moves finished, of the moves the session holds (R-223). */
export interface ReviewProgress {
  readonly done: number;
  readonly total: number;
}

/** The part of the state that outlives an ask. */
type Asks = Pick<
  ReviewSessionState,
  'order' | 'outcomes' | 'size' | 'dayEnd' | 'asked' | 'repeats'
>;

/** Room left for first asks: the size less the moves answered (R-223). */
const room = (s: Asks): number => s.size - s.outcomes.size;

/** The keys still owed an answer: the repeats, and a repeat being asked. */
function owedKeys(s: ReviewSessionState): Set<string> {
  const owed = new Set(s.repeats.map((r) => r.item.key));
  if (s.current?.repeat === true && !s.recorded) owed.add(s.current.item.key);
  return owed;
}

/**
 * The session's progress in moves (R-223): the moves answered with no
 * repeat owed, of the moves the session holds, a total fixed at its start.
 */
export function reviewProgress(s: ReviewSessionState): ReviewProgress {
  const owed = owedKeys(s);
  const done = [...s.outcomes.keys()].filter((k) => !owed.has(k)).length;
  return { done, total: Math.min(s.size, s.order.length) };
}

const graphOf = (
  repertoires: readonly TrainingRepertoire[],
  repertoireId: string,
) => repertoires.find((r) => r.id === repertoireId)?.graph;

/** An item's line so far; undefined when no repertoire holds it. */
type LineOf = (item: QueueItem) => LineTo | undefined;

/**
 * Finds items' lines over `repertoires`, indexing each repertoire's lines
 * once, on its first item: one call walks each repertoire once.
 */
function lineFinder(repertoires: readonly TrainingRepertoire[]): LineOf {
  const indexes = new Map<string, ReadonlyMap<string, LineTo>>();
  const indexOf = (repertoireId: string) => {
    const graph = graphOf(repertoires, repertoireId);
    if (graph === undefined) return undefined;
    const index = indexes.get(repertoireId) ?? linesTo(graph);
    indexes.set(repertoireId, index);
    return index;
  };
  return (item) => indexOf(item.repertoireId)?.get(item.key);
}

/** The item asked after its line so far; undefined when no repertoire holds it. */
function viewOf(
  item: QueueItem,
  lineOf: LineOf,
  repeat = false,
): ReviewItemView | undefined {
  const line = lineOf(item);
  return line && { item, line, reply: null, repeat };
}

/** The items a repertoire still holds, and the answered ones. */
const held = (
  order: readonly QueueItem[],
  outcomes: ReadonlyMap<string, Outcome>,
  lineOf: LineOf,
): QueueItem[] =>
  order.filter((i) => outcomes.has(i.key) || lineOf(i) !== undefined);

/** The first unanswered item in order, if the size has room for it. */
function firstOpen(s: Asks, lineOf: LineOf): ReviewItemView | undefined {
  const open = s.order.find((i) => !s.outcomes.has(i.key));
  return open && room(s) > 0 ? viewOf(open, lineOf) : undefined;
}

const asking = (
  s: Asks,
  current: ReviewItemView | null,
): ReviewSessionState => ({
  order: s.order,
  outcomes: s.outcomes,
  size: s.size,
  dayEnd: s.dayEnd,
  asked: s.asked,
  repeats: s.repeats,
  current,
  phase: 'ask',
  hinted: false,
  recorded: false,
});

/**
 * A session over `items` within `bounds`: it asks `size` moves, repeats on
 * top (R-62, R-78, R-223), and leaves the items it has no room for to
 * "continue".
 */
export function startReviewSession(
  items: readonly QueueItem[],
  repertoires: readonly TrainingRepertoire[],
  bounds: ReviewBounds,
): ReviewSessionState {
  const outcomes = new Map<string, Outcome>();
  const lineOf = lineFinder(repertoires);
  const order = held(items, outcomes, lineOf);
  const { size, dayEnd } = bounds;
  const s: Asks = { order, outcomes, size, dayEnd, asked: 0, repeats: [] };
  return asking(s, firstOpen(s, lineOf) ?? null);
}

interface Chained {
  readonly item: QueueItem;
  readonly move: RepertoireMove;
}

/**
 * The first player move among `afterReply`, if it is an open item of
 * `repertoireId`: R-54, each Review is shown inside one repertoire.
 */
function openAfter(
  s: Asks,
  repertoireId: string,
  afterReply: readonly RepertoireMove[],
  isPlayer: (m: RepertoireMove) => boolean,
): Chained | undefined {
  const move = afterReply.find(isPlayer);
  if (move === undefined) return undefined;
  const key = moveKey(move.from, move.san);
  const item = s.order.find(
    (i) =>
      i.key === key &&
      i.repertoireId === repertoireId &&
      !s.outcomes.has(i.key),
  );
  return item && { item, move };
}

/**
 * R-143: the first opponent reply, in the chapter's insertion order, that a
 * Due move answers; that move is asked next, its line the current one played on.
 */
function chainFrom(
  s: Asks,
  view: ReviewItemView,
  repertoires: readonly TrainingRepertoire[],
): ReviewItemView | undefined {
  const graph = graphOf(repertoires, view.item.repertoireId);
  const answered = view.line.moves.at(-1);
  if (graph === undefined || answered === undefined) return undefined;
  const children = chapterChildren(graph)(view.line.chapterId);
  const isPlayer = (m: RepertoireMove) => isPlayerMove(graph, m);
  for (const reply of children(answered.to)) {
    const chained = openAfter(
      s,
      view.item.repertoireId,
      children(reply.to),
      isPlayer,
    );
    if (chained !== undefined) {
      const moves = [...view.line.moves, reply, chained.move];
      const line = { ...view.line, moves };
      return { item: chained.item, line, reply, repeat: false };
    }
  }
  return undefined;
}

/** `order` with `item` moved to just after `after`. */
function nextAfter(
  order: readonly QueueItem[],
  after: QueueItem,
  item: QueueItem,
): QueueItem[] {
  const rest = order.filter((i) => i !== item);
  const at = rest.indexOf(after) + 1;
  return [...rest.slice(0, at), item, ...rest.slice(at)];
}

/** The earliest repeat, asked if it is due by `at`. */
function repeatDue(
  s: Asks,
  lineOf: LineOf,
  at: number,
): ReviewSessionState | undefined {
  const [first, ...rest] = s.repeats;
  if (first === undefined || first.due.getTime() > at) return undefined;
  const view = viewOf(first.item, lineOf, true);
  return view && asking({ ...s, repeats: rest }, view);
}

/** The chained move, asked at once (R-143), if the size has room for it. */
function askChained(
  s: Asks,
  view: ReviewItemView,
  repertoires: readonly TrainingRepertoire[],
): ReviewSessionState | undefined {
  const next = room(s) > 0 ? chainFrom(s, view, repertoires) : undefined;
  if (next === undefined) return undefined;
  const order = nextAfter(s.order, view.item, next.item);
  return asking({ ...s, order }, next);
}

/**
 * What is asked after the current item: the chained move, asked at once
 * (R-143); else a repeat whose relearning step has run out by `now` (R-78);
 * else the next first ask the size has room for. When none is left, a
 * repeat still inside its step is asked early rather than dropped: the
 * session ends with the move relearned, and FSRS grades the answer at the
 * time it is given.
 */
function following(
  s: Asks,
  view: ReviewItemView,
  find: {
    readonly repertoires: readonly TrainingRepertoire[];
    readonly lineOf: LineOf;
  },
  now: Date,
): ReviewSessionState {
  const { repertoires, lineOf } = find;
  const first = firstOpen(s, lineOf);
  return (
    askChained(s, view, repertoires) ??
    repeatDue(s, lineOf, now.getTime()) ??
    (first && asking(s, first)) ??
    repeatDue(s, lineOf, Infinity) ??
    asking(s, null)
  );
}

/** After a right answer at `now`: the next ask (`following`). */
export function nextReview(
  s: ReviewSessionState,
  repertoires: readonly TrainingRepertoire[],
  now: Date,
): ReviewSessionState {
  if (s.phase !== 'correct' || s.current === null) return s;
  const lineOf = lineFinder(repertoires);
  const repeats = s.repeats.filter((r) => lineOf(r.item) !== undefined);
  const asks = { ...s, order: held(s.order, s.outcomes, lineOf), repeats };
  return following(asks, s.current, { repertoires, lineOf }, now);
}

const still = (state: ReviewSessionState): ReviewTransition => ({
  state,
  emit: null,
});

/**
 * `repeats` with `item` in due order if its `graded` Review is due again
 * before the day ends (R-78), or is still in a minutes-long relearning step,
 * even one that lands after midnight (R-215).
 */
function comeBack(
  s: ReviewSessionState,
  item: QueueItem,
  graded: ReviewState | null,
): readonly Repeat[] {
  if (graded === null) return s.repeats;
  const { due } = graded.fsrs;
  if (due.getTime() >= s.dayEnd.getTime() && !inShortTermStep(graded))
    return s.repeats;
  return [...s.repeats, { item, due }].sort(
    (a, b) => a.due.getTime() - b.due.getTime(),
  );
}

/**
 * Emits the ask's outcome with the move's Review graded by it. A first
 * ask's outcome becomes the item's; the move's repeat, if it comes back
 * today, is owed from now on (R-78).
 */
function record(
  s: ReviewSessionState,
  view: ReviewItemView,
  answer: { readonly outcome: Outcome; readonly clock: ReviewClock },
  change: Partial<Pick<ReviewSessionState, 'phase' | 'hinted'>>,
): ReviewTransition {
  const { item } = view;
  const { outcome, clock } = answer;
  const outcomes = view.repeat
    ? s.outcomes
    : new Map(s.outcomes).set(item.key, outcome);
  const before = clock.reviews.get(item.key);
  const review = before ? grade(before, outcome, clock.now) : null;
  const repeats = comeBack(s, item, review);
  const { key, repertoireId } = item;
  const emit = { key, repertoireId, outcome, review };
  const asked = s.asked + 1;
  return {
    state: { ...s, ...change, outcomes, repeats, asked, recorded: true },
    emit,
  };
}

/** The player's move for the current item, at the clock's time. */
export function answerReview(
  s: ReviewSessionState,
  san: string,
  clock: ReviewClock,
): ReviewTransition {
  const view = s.current;
  if (view === null || s.phase === 'correct') return still(s);
  if (san === view.item.san) {
    return s.recorded
      ? still({ ...s, phase: 'correct' })
      : record(s, view, { outcome: 'pass', clock }, { phase: 'correct' });
  }
  if (!s.recorded)
    return record(s, view, { outcome: 'lapse', clock }, { phase: 'replay' });
  // Already a Lapse or a hint: show the arrow (R-59), record nothing more.
  return still(s.phase === 'replay' ? s : { ...s, phase: 'replay' });
}

/** R-61: a hint, before any other outcome, counts as a Lapse. */
export function hintReview(
  s: ReviewSessionState,
  clock: ReviewClock,
): ReviewTransition {
  const view = s.current;
  if (view === null || s.recorded) return still(s);
  return record(s, view, { outcome: 'hint', clock }, { hinted: true });
}
