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
import { chapterWalks } from '../repertoire/walk';
import type { Result } from '../result';
import { isDue, type ReviewState } from './schedule';
import type { TrainingRepertoire } from './scope';

/** R-62: how many Reviews a session holds and how many new moves a day. */
export interface QueueLimits {
  /** Reviews per session: a player setting, a whole number from 10 to 100. */
  readonly reviews: number;
  /**
   * New moves per day: a whole number, 0 or more (the player setting allows
   * 0 to 50, R-146).
   */
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

export interface QueueInput {
  readonly repertoires: readonly TrainingRepertoire[];
  /** The player's Reviews by review key. */
  readonly reviews: ReadonlyMap<string, ReviewState>;
  /** New moves already learned today; they count against the allowance. */
  readonly learnedToday: number;
  /**
   * Keys already shown for learning in this session: "continue" (R-62)
   * leaves them out of the new moves, so the next batch teaches other moves.
   * It never holds back a Review: a Review graded this session is offered
   * again only when it is Due again, as a Lapse is within minutes (R-78), and
   * that repeat counts toward the session size.
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
 * The player moves of every chapter in line order: depth first from the root,
 * children in insertion order, each move of a chapter once (the chapter walk),
 * so a transposing chapter costs its size, not its number of lines.
 */
function playerMoves(graph: RepertoireGraph): RepertoireMove[] {
  const walks = chapterWalks(graph);
  return graph.chapters
    .flatMap((c) => walks(c.id).moves())
    .filter((m) => isPlayerMove(graph, m));
}

interface Due {
  readonly item: QueueItem;
  readonly due: number;
}

/**
 * The moves training holds: every player move a chapter walk of the active
 * repertoires reaches, each key once, named by the first repertoire that
 * holds it. Paused repertoires (R-46) hold none. The one definition of a held
 * move that the queue and the training day read.
 */
export const heldMoves = (
  repertoires: readonly TrainingRepertoire[],
): QueueItem[] => walkedMoves(repertoires.filter((r) => r.active));

/** Every player move the repertoires' chapter walks reach, each key once. */
export function walkedMoves(
  repertoires: readonly TrainingRepertoire[],
): QueueItem[] {
  const seen = new Set<string>();
  const items: QueueItem[] = [];
  for (const r of repertoires) {
    for (const m of playerMoves(r.graph)) {
      const key = moveKey(m.from, m.san);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ key, repertoireId: r.id, fromKey: m.from, san: m.san });
    }
  }
  return items;
}

/** The Review of `key` if it is due at `now`. */
function dueAt(
  reviews: ReadonlyMap<string, ReviewState>,
  key: string,
  now: Date,
): ReviewState | undefined {
  const review = reviews.get(key);
  return review !== undefined && isDue(review, now) ? review : undefined;
}

/** R-62, R-146: the new moves today still allows, never below zero. */
export const newMovesLeft = (
  limits: Pick<QueueLimits, 'newPerDay'>,
  learnedToday: number,
): number => Math.max(0, limits.newPerDay - learnedToday);

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
  const shown = input.exclude ?? new Set();
  for (const item of heldMoves(input.repertoires)) {
    const review = dueAt(input.reviews, item.key, now);
    if (review !== undefined) {
      due.push({ item, due: review.fsrs.due.getTime() });
    } else if (!input.reviews.has(item.key) && !shown.has(item.key)) {
      fresh.push(item);
    }
  }
  return {
    ok: true,
    value: {
      reviews: due
        .sort((a, b) => a.due - b.due)
        .slice(0, limits.reviews)
        .map((d) => d.item),
      newMoves: fresh.slice(0, newMovesLeft(limits, input.learnedToday)),
    },
  };
}
