/**
 * The coach dashboard's one read (R-229, #381): every linked player with
 * the rows their player page shows (coachPlayerProgress), read in one
 * repeatable-read snapshot. The domain decides (isCoachLinked,
 * progressRepertoires), each entry loads through its scope (entryRead,
 * Q26) as playerRepertoires does for the player page, and each repertoire
 * loads once per scope for the whole read. The players' Reviews and last
 * training are read once for all of them. Statements: fixed in players,
 * plus 4 per distinct repertoire and scope.
 */
import type { TrackedReview } from '@mychess/chess';
import {
  isCoachLinked,
  scopeKey,
  type CoachProgressFacts,
} from '@mychess/domain';
import { REPEATABLE_READ, type Db, type Executor } from '../client';
import { coachPlayers, type LinkedAccount } from '../coaching';
import { trackedReviews } from '../training/reviews';
import {
  playerRepertoires,
  rowOf,
  type LoadVisible,
  type ProgressRow,
  type Shown,
} from './coach-progress';
import { coachProgressFacts, lastTrained } from './facts';
import { keysOf, loadVisible, type LoadedGraph } from './view';

/** A linked player on the dashboard, with what their player page shows. */
export interface DashboardPlayer extends LinkedAccount {
  /** The latest result on a repertoire the coach may see; null for none. */
  readonly lastTrained: Date | null;
  /** As coachPlayerProgress gives them: assigned (by name), then shared. */
  readonly rows: readonly ProgressRow[];
}

const NO_REVIEWS: ReadonlyMap<string, TrackedReview> = new Map();

/** loadVisible, each (scope, repertoire) loaded once for the whole read. */
function loadOnce(tx: Executor): LoadVisible {
  const cache = new Map<string, Promise<LoadedGraph | undefined>>();
  return (scope, id) => {
    const key = `${scopeKey(scope)}:${id}`;
    const loading = cache.get(key) ?? loadVisible(tx, scope, id);
    cache.set(key, loading);
    return loading;
  };
}

/**
 * What each player the domain finds linked (isCoachLinked) is shown, by
 * player id; nothing for anyone else.
 */
async function shownByPlayer(
  tx: Executor,
  coachId: string,
  facts: ReadonlyMap<string, CoachProgressFacts>,
): Promise<Map<string, Shown[]>> {
  const load = loadOnce(tx);
  const out = new Map<string, Shown[]>();
  for (const [playerId, one] of facts) {
    if (!isCoachLinked(coachId, playerId, one)) continue;
    out.set(
      playerId,
      await playerRepertoires(load, { coachId, playerId, facts: one }),
    );
  }
  return out;
}

/**
 * The coach dashboard, its one read: the coach's linked players by display
 * name (coachPlayers), each with when they last trained (R-154) and the
 * rows of their player page.
 */
export function coachDashboard(
  db: Db,
  coachId: string,
  now: Date,
): Promise<DashboardPlayer[]> {
  return db.transaction(async (tx) => {
    const players = await coachPlayers(tx, coachId);
    const facts = await coachProgressFacts(
      tx,
      coachId,
      players.map((player) => player.id),
    );
    const shown = await shownByPlayer(tx, coachId, facts);
    // A repertoire loaded once is one graph object, however many players see it.
    const graphs = [
      ...new Set([...shown.values()].flat().map((one) => one.loaded.graph)),
    ];
    const tracked = await trackedReviews(tx, [...shown.keys()], keysOf(graphs));
    const last = await lastTrained(tx, coachId, facts);
    return players.flatMap((player) => {
      const theirs = shown.get(player.id);
      if (theirs === undefined) return [];
      const reviews = tracked.get(player.id) ?? NO_REVIEWS;
      return [
        {
          ...player,
          lastTrained: last.get(player.id) ?? null,
          rows: theirs.map((one) => rowOf(one, reviews, now)),
        },
      ];
    });
  }, REPEATABLE_READ);
}
