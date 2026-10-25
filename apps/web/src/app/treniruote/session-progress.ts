// Where the repertoires in scope stand when a session ends (the Done
// state's "Next review" line and its learned / due / to-learn bar). The
// drill passes its local reviews, graded during the session, so the summary
// shows the session's effect before the server has every result.
import {
  playerKeys,
  type RepertoireGraph,
  type ReviewState,
} from '@mychess/chess';

export interface RepertoireProgress {
  /** Held own moves with a Review (the due ones included). */
  readonly learned: number;
  /** Of those, the ones due at `now`. */
  readonly due: number;
  /** Held own moves without a Review. */
  readonly toLearn: number;
  /** The earliest Review due after `now`, or null when none is. */
  readonly nextReview: Date | null;
}

/**
 * The progress over the own moves the active `entries` hold. Paused
 * entries and Reviews of moves not held are left out.
 */
export function repertoireProgress(
  entries: readonly {
    readonly graph: RepertoireGraph;
    readonly active: boolean;
  }[],
  reviews: ReadonlyMap<string, ReviewState>,
  now: Date,
): RepertoireProgress {
  const held = new Set(
    entries.filter((e) => e.active).flatMap((e) => playerKeys(e.graph)),
  );
  const dues = [...held].flatMap((key) => {
    const review = reviews.get(key);
    return review === undefined ? [] : [review.fsrs.due.getTime()];
  });
  const later = dues.filter((due) => due > now.getTime());
  return {
    learned: dues.length,
    due: dues.length - later.length,
    toLearn: held.size - dues.length,
    nextReview: later.length === 0 ? null : new Date(Math.min(...later)),
  };
}
