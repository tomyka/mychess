/**
 * Where each assigned player stands on one of the coach's repertoires, for
 * the coach's Repertoire screen (R-225, #385): one repeatable-read
 * snapshot whatever the number of players. The access step is
 * coachRepertoireProgress's (grantedReads), for every player at once; each
 * granted entry loads through its scope (Q26), and only the granted
 * players' Reviews are read. Statements:
 * fixed in the number of players; the graph loads once per scope, so once
 * for the coach's own repertoire.
 */
import {
  repertoireStanding,
  type Standing,
  type TrackedReview,
} from '@mychess/chess';
import { scopeKey } from '@mychess/domain';
import { REPEATABLE_READ, type Db, type Executor } from '../client';
import { isUuid } from '../ids';
import { trackedReviews } from '../training/reviews';
import { grantedReads, type GrantedRead } from './granted';
import { keysOf, loadVisible, type LoadedGraph } from './view';

/** Which players' standings on which repertoire, asked by which coach. */
export interface AssigneeStandingsRequest {
  /** The acting coach: the session's, never one a client names. */
  readonly coachId: string;
  readonly repertoireId: string;
  readonly playerIds: readonly string[];
}

/**
 * The repertoire as each player's scope reaches it, by player id: loaded
 * once per scope. No entry where the scope does not reach it.
 */
async function graphsOf(
  tx: Executor,
  repertoireId: string,
  granted: readonly GrantedRead[],
): Promise<Map<string, LoadedGraph>> {
  const byScope = new Map<string, LoadedGraph | undefined>();
  const out = new Map<string, LoadedGraph>();
  for (const { playerId, read } of granted) {
    const { scope } = read;
    const key = scopeKey(scope);
    if (!byScope.has(key))
      byScope.set(key, await loadVisible(tx, scope, repertoireId));
    const loaded = byScope.get(key);
    if (loaded !== undefined) out.set(playerId, loaded);
  }
  return out;
}

/** The standing of each player shown one, by player id. */
async function standingsOf(
  tx: Executor,
  graphs: ReadonlyMap<string, LoadedGraph>,
  now: Date,
): Promise<Map<string, Standing>> {
  const distinct = new Set([...graphs.values()].map((one) => one.graph));
  const tracked = await trackedReviews(
    tx,
    [...graphs.keys()],
    keysOf([...distinct]),
  );
  const none: ReadonlyMap<string, TrackedReview> = new Map();
  return new Map(
    [...graphs].map(([playerId, { graph }]) => [
      playerId,
      repertoireStanding(graph, tracked.get(playerId) ?? none, now),
    ]),
  );
}

/**
 * Each of `playerIds`' standing on `repertoireId` as the progress page
 * would show it (counts and mastered), by player id; null wherever
 * coachRepertoireProgress is undefined: unlinked, forked, not this
 * coach's, a malformed id. No statement for no players or a malformed id.
 */
export function coachAssigneeStandings(
  db: Db,
  { coachId, repertoireId, playerIds }: AssigneeStandingsRequest,
  now: Date,
): Promise<Map<string, Standing | null>> {
  const ids = [...new Set(playerIds)];
  const withNone = (shown: ReadonlyMap<string, Standing>) =>
    new Map(ids.map((id) => [id, shown.get(id) ?? null]));
  if (ids.length === 0 || !isUuid(repertoireId))
    return Promise.resolve(withNone(new Map()));
  return db.transaction(async (tx) => {
    const granted = await grantedReads(tx, coachId, repertoireId, ids);
    const graphs = await graphsOf(tx, repertoireId, granted);
    return withNone(await standingsOf(tx, graphs, now));
  }, REPEATABLE_READ);
}
