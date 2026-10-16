/**
 * The daily queue (R-53, R-62): due reviews across every active repertoire,
 * then new moves for the learn pass. A move held by several repertoires or
 * chapters has one card, so it is offered once.
 */
import {
  isPlayerMove,
  moveKey,
  type RepertoireGraph,
  type RepertoireMove,
} from '../repertoire/graph';
import type { ReviewCard } from './schedule';

/** R-62: at most this many reviews per session and new moves per day. */
export const QUEUE_LIMITS = { reviews: 20, newPerDay: 10 } as const;

export interface QueueRepertoire {
  readonly id: string;
  readonly graph: RepertoireGraph;
  readonly paused: boolean;
}

export interface QueueInput {
  readonly repertoires: readonly QueueRepertoire[];
  /** Review cards by review key. */
  readonly cards: ReadonlyMap<string, ReviewCard>;
  /** New moves already learned today; they count against the allowance. */
  readonly learnedToday: number;
}

export interface QueueItem {
  readonly key: string;
  readonly repertoireId: string;
  readonly fromKey: string;
  readonly san: string;
}

export interface Queue {
  /** Due reviews, the longest overdue first. */
  readonly reviews: readonly QueueItem[];
  /** Moves without a card, in line order. */
  readonly newMoves: readonly QueueItem[];
}

/**
 * A chapter's moves in line order: depth first from the root, children in
 * insertion order. Each position is expanded once, so a transposing chapter
 * costs its size, not its number of lines.
 */
function chapterMoves(
  graph: RepertoireGraph,
  rootKey: string,
  chapterId: string,
): RepertoireMove[] {
  const childrenOf = (key: string) =>
    graph.moves
      .filter((m) => m.from === key && m.chapters.includes(chapterId))
      .reverse();
  const out: RepertoireMove[] = [];
  const expanded = new Set([rootKey]);
  const stack = childrenOf(rootKey);
  for (let move = stack.pop(); move !== undefined; move = stack.pop()) {
    out.push(move);
    if (expanded.has(move.to)) continue;
    expanded.add(move.to);
    stack.push(...childrenOf(move.to));
  }
  return out;
}

function playerMoves(graph: RepertoireGraph): RepertoireMove[] {
  return graph.chapters
    .flatMap((c) => chapterMoves(graph, c.rootKey, c.id))
    .filter((m) => isPlayerMove(graph, m));
}

interface Due {
  readonly item: QueueItem;
  readonly due: number;
}

/** Every player move of the active repertoires, each key once. */
function queueItems(repertoires: readonly QueueRepertoire[]): QueueItem[] {
  const seen = new Set<string>();
  const items: QueueItem[] = [];
  for (const r of repertoires.filter((x) => !x.paused)) {
    for (const m of playerMoves(r.graph)) {
      const key = moveKey(m.from, m.san);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ key, repertoireId: r.id, fromKey: m.from, san: m.san });
    }
  }
  return items;
}

export function buildQueue(input: QueueInput, now: Date): Queue {
  const due: Due[] = [];
  const fresh: QueueItem[] = [];
  for (const item of queueItems(input.repertoires)) {
    const card = input.cards.get(item.key);
    if (card === undefined) fresh.push(item);
    else if (card.fsrs.due.getTime() <= now.getTime()) {
      due.push({ item, due: card.fsrs.due.getTime() });
    }
  }
  const allowance = Math.max(0, QUEUE_LIMITS.newPerDay - input.learnedToday);
  return {
    reviews: due
      .sort((a, b) => a.due - b.due)
      .slice(0, QUEUE_LIMITS.reviews)
      .map((d) => d.item),
    newMoves: fresh.slice(0, allowance),
  };
}
