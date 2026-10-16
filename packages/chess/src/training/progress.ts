/**
 * Progress maths over Reviews (R-56) and the reconciliation of Reviews
 * with a repertoire after a coach edit (ruling Q30).
 */
import { DAY_MS, retrievability, type ReviewState } from './schedule';

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
 * Whether every key has a Review that the player still recalls well. No keys
 * is not mastered: there is nothing to master.
 */
export function mastered(
  keys: Iterable<string>,
  reviews: ReadonlyMap<string, ReviewState>,
  now: Date,
): boolean {
  const all = [...keys];
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
 * pass the repertoire's `currentKeys` to leave such dormant Reviews out.
 * Without `currentKeys` every Review counts.
 */
export function weakSpots(
  reviews: ReadonlyMap<string, ReviewState>,
  now: Date,
  currentKeys?: ReadonlySet<string>,
): WeakSpot[] {
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

export interface Reconciliation {
  /** Current keys with a review: their review state carries on. */
  readonly kept: readonly string[];
  /** Current keys without a review: they join the learn queue. */
  readonly toLearn: readonly string[];
  /** Reviewed keys the repertoire no longer holds: they leave review. */
  readonly dormant: readonly string[];
}

/**
 * Reconciles reviews with a repertoire's current review keys (Q30). A changed
 * move has a new key, so it lands in `toLearn` and its old key goes dormant.
 * The reviews already say what was there before, so no previous keys are needed.
 */
export function reconcile(
  currentKeys: ReadonlySet<string>,
  reviews: ReadonlyMap<string, unknown>,
): Reconciliation {
  const current = [...currentKeys].sort();
  return {
    kept: current.filter((k) => reviews.has(k)),
    toLearn: current.filter((k) => !reviews.has(k)),
    dormant: [...reviews.keys()].filter((k) => !currentKeys.has(k)).sort(),
  };
}
