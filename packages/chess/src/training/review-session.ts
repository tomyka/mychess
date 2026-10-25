/**
 * The review session (R-143, R-59, R-61, R-78): the queue's Due Reviews asked
 * one at a time, each after its line so far. After a right answer the
 * session chains into the opponent's reply and a Due move that follows it,
 * so the player plays on in the line; otherwise it jumps to the next item.
 * Each item emits one outcome, the first of a hint, a Lapse or a pass, for
 * the caller to grade; replaying the move after a Lapse records nothing.
 */
import {
  isPlayerMove,
  moveKey,
  type RepertoireMove,
} from '../repertoire/graph';
import { chapterChildren } from '../repertoire/walk';
import { linesTo, type LineTo } from './line-to';
import type { QueueItem } from './queue';
import type { Outcome } from './schedule';
import type { TrainingRepertoire } from './scope';

/** `replay`: after a Lapse, the arrow is shown until the move is played. */
export type ReviewPhase = 'ask' | 'replay' | 'correct';

export interface ReviewItemView {
  readonly item: QueueItem;
  /** From the chapter's root; the asked move is last. */
  readonly line: LineTo;
  /** The chained opponent reply, shown before asking. */
  readonly reply: RepertoireMove | null;
}

export interface ReviewSessionState {
  readonly order: readonly QueueItem[];
  readonly outcomes: ReadonlyMap<string, Outcome>;
  /** Null when every item is answered. */
  readonly current: ReviewItemView | null;
  readonly phase: ReviewPhase;
  readonly hinted: boolean;
}

export interface ReviewEmit {
  readonly key: string;
  readonly repertoireId: string;
  readonly outcome: Outcome;
}

export interface ReviewTransition {
  readonly state: ReviewSessionState;
  readonly emit: ReviewEmit | null;
}

/** Items answered, of the items the session holds. */
export interface ReviewCounts {
  readonly done: number;
  readonly total: number;
}

export const reviewCounts = (s: ReviewSessionState): ReviewCounts => ({
  done: s.outcomes.size,
  total: s.order.length,
});

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
function viewOf(item: QueueItem, lineOf: LineOf): ReviewItemView | undefined {
  const line = lineOf(item);
  return line && { item, line, reply: null };
}

/** The items a repertoire still holds, and the answered ones. */
const held = (
  order: readonly QueueItem[],
  outcomes: ReadonlyMap<string, Outcome>,
  lineOf: LineOf,
): QueueItem[] =>
  order.filter((i) => outcomes.has(i.key) || lineOf(i) !== undefined);

/** The first unanswered item in order. */
function firstOpen(
  order: readonly QueueItem[],
  outcomes: ReadonlyMap<string, Outcome>,
  lineOf: LineOf,
): ReviewItemView | null {
  const open = order.find((i) => !outcomes.has(i.key));
  return (open && viewOf(open, lineOf)) ?? null;
}

const asking = (
  order: readonly QueueItem[],
  outcomes: ReadonlyMap<string, Outcome>,
  current: ReviewItemView | null,
): ReviewSessionState => ({
  order,
  outcomes,
  current,
  phase: 'ask',
  hinted: false,
});

export function startReviewSession(
  items: readonly QueueItem[],
  repertoires: readonly TrainingRepertoire[],
): ReviewSessionState {
  const outcomes = new Map<string, Outcome>();
  const lineOf = lineFinder(repertoires);
  const order = held(items, outcomes, lineOf);
  return asking(order, outcomes, firstOpen(order, outcomes, lineOf));
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
  s: ReviewSessionState,
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
  s: ReviewSessionState,
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
      return { item: chained.item, line: { ...view.line, moves }, reply };
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

/** After a right answer: the chained item, else the next open one. */
export function nextReview(
  s: ReviewSessionState,
  repertoires: readonly TrainingRepertoire[],
): ReviewSessionState {
  if (s.phase !== 'correct' || s.current === null) return s;
  const view = s.current;
  const lineOf = lineFinder(repertoires);
  const order = held(s.order, s.outcomes, lineOf);
  const chained = chainFrom({ ...s, order }, view, repertoires);
  if (chained !== undefined)
    return asking(
      nextAfter(order, view.item, chained.item),
      s.outcomes,
      chained,
    );
  return asking(order, s.outcomes, firstOpen(order, s.outcomes, lineOf));
}

const still = (state: ReviewSessionState): ReviewTransition => ({
  state,
  emit: null,
});

/** Records the item's one outcome and emits it. */
function record(
  s: ReviewSessionState,
  item: QueueItem,
  outcome: Outcome,
  change: Partial<Pick<ReviewSessionState, 'phase' | 'hinted'>>,
): ReviewTransition {
  const outcomes = new Map(s.outcomes).set(item.key, outcome);
  const emit = { key: item.key, repertoireId: item.repertoireId, outcome };
  return { state: { ...s, ...change, outcomes }, emit };
}

/** The player's move for the current item. */
export function answerReview(
  s: ReviewSessionState,
  san: string,
): ReviewTransition {
  const item = s.current?.item;
  if (item === undefined || s.phase === 'correct') return still(s);
  const answered = s.outcomes.has(item.key);
  if (san === item.san) {
    return answered
      ? still({ ...s, phase: 'correct' })
      : record(s, item, 'pass', { phase: 'correct' });
  }
  if (!answered) return record(s, item, 'lapse', { phase: 'replay' });
  // Already a Lapse or a hint: show the arrow (R-59), record nothing more.
  return still(s.phase === 'replay' ? s : { ...s, phase: 'replay' });
}

/** R-61: a hint, before any other outcome, counts as a Lapse. */
export function hintReview(s: ReviewSessionState): ReviewTransition {
  const item = s.current?.item;
  if (item === undefined || s.outcomes.has(item.key)) return still(s);
  return record(s, item, 'hint', { hinted: true });
}
