// What a repertoire page needs to count the new moves learning one chapter
// or line would teach today (R-206), sent by the server as plain data; the
// count itself is chess's learn plan, over this repertoire alone, within
// the Allowance.
import type {
  LearnDay,
  LearnFocus,
  QueueLimits,
  RepertoireGraph,
} from '@mychess/chess';

/** The player's learning of one repertoire, as its page counts it. */
export interface LearnScope {
  /** This repertoire's own moves the player already tracks (R-181). */
  readonly tracked: readonly string[];
  readonly learnedToday: number;
  readonly limits: QueueLimits;
}

/**
 * The learn day of one repertoire, its whole or one chapter or line of it.
 * Built here, not narrowed with chess's repertoireDay: the page holds this
 * repertoire's LearnScope, not a whole training day.
 */
export function learnDayOf(
  repertoireId: string,
  graph: RepertoireGraph,
  scope: LearnScope,
  focus?: Omit<LearnFocus, 'repertoireId'>,
): LearnDay {
  return {
    repertoires: [{ id: repertoireId, graph, active: true }],
    tracked: new Set(scope.tracked),
    learnedToday: scope.learnedToday,
    limits: scope.limits,
    ...(focus === undefined ? {} : { focus: { repertoireId, ...focus } }),
  };
}
