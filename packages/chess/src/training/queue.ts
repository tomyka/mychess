/**
 * The daily queue (R-53, R-62): Due Reviews across every active repertoire,
 * then new moves for the learn pass. A move held by several repertoires or
 * chapters has one Review, so it is offered once.
 */
import {
  isPlayerMove,
  moveKey,
  type RepertoireGraph,
  type RepertoireMove,
} from '../repertoire/graph';
import type { Result } from '../result';
import type { ReviewState } from './schedule';

/** R-62: how many Reviews a session holds and how many new moves a day. */
export interface QueueLimits {
  /** Reviews per session: a player setting, a whole number from 10 to 100. */
  readonly reviews: number;
  /** New moves per day: a whole number, 0 or more. */
  readonly newPerDay: number;
}

/** R-62: the defaults, 20 Reviews a session and 10 new moves a day. */
export const QUEUE_LIMITS: QueueLimits = { reviews: 20, newPerDay: 10 };

/** R-62: the range of the player's session-size setting. */
const SESSION_REVIEWS = { min: 10, max: 100 } as const;

/** A limit out of range; `limit` names which one. */
export interface QueueRefusal {
  readonly reason: 'queue.invalidLimit';
  readonly limit: keyof QueueLimits;
}

export interface QueueRepertoire {
  readonly id: string;
  readonly graph: RepertoireGraph;
  /**
   * False when the repertoire is excluded from training: the player paused
   * their Assignment of it (R-46). It stays assigned but adds no Reviews and
   * no new moves.
   */
  readonly active: boolean;
}

export interface QueueInput {
  readonly repertoires: readonly QueueRepertoire[];
  /** The player's Reviews by review key. */
  readonly reviews: ReadonlyMap<string, ReviewState>;
  /** New moves already learned today; they count against the allowance. */
  readonly learnedToday: number;
  /**
   * Keys already reviewed in this session. "Continue" (R-62) builds the
   * queue again with them left out, so the next batch holds other moves.
   */
  readonly exclude?: ReadonlySet<string>;
}

export interface QueueItem {
  readonly key: string;
  readonly repertoireId: string;
  readonly fromKey: string;
  readonly san: string;
}

export interface Queue {
  /** Due Reviews, the earliest due first. */
  readonly reviews: readonly QueueItem[];
  /** Moves without a Review, in line order. */
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

/**
 * Every player move of the active repertoires, each key once, leaving out
 * the keys in `exclude`.
 */
function queueItems(
  repertoires: readonly QueueRepertoire[],
  exclude: ReadonlySet<string>,
): QueueItem[] {
  const seen = new Set(exclude);
  const items: QueueItem[] = [];
  for (const r of repertoires.filter((x) => x.active)) {
    for (const m of playerMoves(r.graph)) {
      const key = moveKey(m.from, m.san);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ key, repertoireId: r.id, fromKey: m.from, san: m.san });
    }
  }
  return items;
}

/** Which limit, if any, is out of the range R-62 allows. */
function invalidLimit(limits: QueueLimits): keyof QueueLimits | null {
  const { reviews, newPerDay } = limits;
  if (
    !Number.isInteger(reviews) ||
    reviews < SESSION_REVIEWS.min ||
    reviews > SESSION_REVIEWS.max
  ) {
    return 'reviews';
  }
  return Number.isInteger(newPerDay) && newPerDay >= 0 ? null : 'newPerDay';
}

/**
 * The queue at `now`: up to `limits.reviews` Due Reviews, the earliest due
 * first, and new moves up to what is left of today's allowance. Refuses
 * limits out of range rather than clamping them.
 */
export function buildQueue(
  input: QueueInput,
  now: Date,
  limits: QueueLimits = QUEUE_LIMITS,
): Result<Queue, QueueRefusal> {
  const limit = invalidLimit(limits);
  if (limit !== null) {
    return { ok: false, refusal: { reason: 'queue.invalidLimit', limit } };
  }
  const due: Due[] = [];
  const fresh: QueueItem[] = [];
  for (const item of queueItems(
    input.repertoires,
    input.exclude ?? new Set(),
  )) {
    const review = input.reviews.get(item.key);
    if (review === undefined) fresh.push(item);
    else if (review.fsrs.due.getTime() <= now.getTime()) {
      due.push({ item, due: review.fsrs.due.getTime() });
    }
  }
  const allowance = Math.max(0, limits.newPerDay - input.learnedToday);
  return {
    ok: true,
    value: {
      reviews: due
        .sort((a, b) => a.due - b.due)
        .slice(0, limits.reviews)
        .map((d) => d.item),
      newMoves: fresh.slice(0, allowance),
    },
  };
}
