/**
 * Progress maths over review cards (R-56) and the reconciliation of cards
 * with a repertoire after a coach edit (ruling Q30).
 */
import { retrievability, type ReviewCard } from './schedule';

/** R-56: a set of moves is mastered when every move has at least this recall. */
export const MASTERY_RETENTION = 0.9;
/** R-56: a move with recall below this is a weak spot. */
export const WEAK_RETENTION = 0.7;
/** R-56: a move with this many lapses within the window is a weak spot. */
export const WEAK_LAPSES = 2;
export const WEAK_WINDOW_DAYS = 30;

const DAY = 86_400_000;

export interface WeakSpot {
  readonly key: string;
  readonly recentLapses: number;
  readonly recall: number;
}

/** Whether every key has a card that the player still recalls well. */
export function mastered(
  keys: Iterable<string>,
  cards: ReadonlyMap<string, ReviewCard>,
  now: Date,
): boolean {
  return [...keys].every((key) => {
    const card = cards.get(key);
    return card !== undefined && retrievability(card, now) >= MASTERY_RETENTION;
  });
}

/** Cards that lapse often or are fading, the weakest first. */
export function weakSpots(
  cards: ReadonlyMap<string, ReviewCard>,
  now: Date,
): WeakSpot[] {
  const since = now.getTime() - WEAK_WINDOW_DAYS * DAY;
  return [...cards.values()]
    .map((card) => ({
      key: card.key,
      recentLapses: card.lapses.filter((at) => at.getTime() >= since).length,
      recall: retrievability(card, now),
    }))
    .filter((s) => s.recentLapses >= WEAK_LAPSES || s.recall < WEAK_RETENTION)
    .sort((a, b) => b.recentLapses - a.recentLapses || a.recall - b.recall);
}

export interface Reconciliation {
  /** Current keys with a card: their review state carries on. */
  readonly kept: readonly string[];
  /** Current keys without a card: they join the learn queue. */
  readonly toLearn: readonly string[];
  /** Carded keys the repertoire no longer holds: they leave review. */
  readonly dormant: readonly string[];
}

/**
 * Reconciles cards with a repertoire's current review keys (Q30). A changed
 * move has a new key, so it lands in `toLearn` and its old key goes dormant.
 * The cards already say what was there before, so no previous keys are needed.
 */
export function reconcile(
  currentKeys: ReadonlySet<string>,
  cards: ReadonlyMap<string, unknown>,
): Reconciliation {
  const current = [...currentKeys].sort();
  return {
    kept: current.filter((k) => cards.has(k)),
    toLearn: current.filter((k) => !cards.has(k)),
    dormant: [...cards.keys()].filter((k) => !currentKeys.has(k)).sort(),
  };
}
