/**
 * Progress over Reviews: mastery of a scope and weak spots (R-56), and the
 * reconciliation of Reviews with the repertoires after a coach edit (Q30).
 */
import { playerKeys, type RepertoireGraph } from '../repertoire/graph';
import { DAY_MS, retrievability, type ReviewState } from './schedule';
import {
  repertoireKeys,
  scopeKeys,
  type Scope,
  type TrainingRepertoire,
} from './scope';

/** R-56: a set of moves is mastered when every move has at least this recall. */
export const MASTERY_RETENTION = 0.9;
/** R-56: a move with recall below this is a weak spot. */
export const WEAK_RETENTION = 0.7;
/** R-56: a move with this many lapses within the window is a weak spot. */
export const WEAK_LAPSES = 2;
export const WEAK_WINDOW_DAYS = 30;

export interface WeakSpot {
  readonly key: string;
  readonly recentLapses: number;
  readonly recall: number;
}

/**
 * Whether the scope is mastered at `now` (R-56): every move it covers has a
 * Review that the player still recalls well. A scope without moves (an empty
 * line, an unknown chapter) is not mastered: there is nothing to master.
 */
export function mastered(
  scope: Scope,
  reviews: ReadonlyMap<string, ReviewState>,
  now: Date,
): boolean {
  const all = scopeKeys(scope);
  return (
    all.length > 0 &&
    all.every((key) => {
      const review = reviews.get(key);
      return (
        review !== undefined && retrievability(review, now) >= MASTERY_RETENTION
      );
    })
  );
}

/**
 * Reviews that lapse often or are fading, the weakest first. A Review whose
 * move a coach edit removed goes dormant (`reconcile`) but keeps its state;
 * pass the player's `repertoires` to leave such dormant Reviews out.
 * Without them every Review counts.
 */
export function weakSpots(
  reviews: ReadonlyMap<string, ReviewState>,
  now: Date,
  repertoires?: readonly TrainingRepertoire[],
): WeakSpot[] {
  const currentKeys = repertoires && repertoireKeys(repertoires);
  const since = now.getTime() - WEAK_WINDOW_DAYS * DAY_MS;
  return [...reviews.values()]
    .filter((review) => currentKeys?.has(review.key) ?? true)
    .map((review) => ({
      key: review.key,
      recentLapses: review.lapses.filter((at) => at.getTime() >= since).length,
      recall: retrievability(review, now),
    }))
    .filter((s) => s.recentLapses >= WEAK_LAPSES || s.recall < WEAK_RETENTION)
    .sort((a, b) => b.recentLapses - a.recentLapses || a.recall - b.recall);
}

/**
 * Whether every player move of `graph` is learned (R-129: an Assignment is
 * done). `learned` holds the keys with a Review: the learn pass passed or
 * "I know this" (R-58). Nothing to learn counts as done.
 */
export function allLearned(
  graph: RepertoireGraph,
  learned: ReadonlySet<string>,
): boolean {
  return playerKeys(graph).every((k) => learned.has(k));
}

export interface Reconciliation {
  /** Current keys with a review: their review state carries on. */
  readonly kept: readonly string[];
  /** Current keys without a review: they join the learn queue. */
  readonly toLearn: readonly string[];
  /** Reviewed keys the repertoire no longer holds: they leave review. */
  readonly dormant: readonly string[];
}

/**
 * Reconciles the player's Reviews with the repertoires they hold (R-23, R-44,
 * ruling Q30). A changed move has a new key, so it lands in `toLearn` and
 * its old key goes dormant. A paused repertoire (R-46) is still held, so its
 * Reviews are kept. The Reviews already say what was there before, so no
 * previous version of a repertoire is needed.
 */
export function reconcile(
  repertoires: readonly TrainingRepertoire[],
  reviews: ReadonlyMap<string, unknown>,
): Reconciliation {
  const currentKeys = repertoireKeys(repertoires);
  const current = [...currentKeys].sort();
  return {
    kept: current.filter((k) => reviews.has(k)),
    toLearn: current.filter((k) => !reviews.has(k)),
    dormant: [...reviews.keys()].filter((k) => !currentKeys.has(k)).sort(),
  };
}
