/**
 * What the coach progress reads show, built from what they loaded: the
 * repertoires a coach may see progress on (each with its graph), their
 * player-move keys, and one mapping of each entry the domain decided
 * (entryRead): the scope it loads through and, once loaded, its Coach view
 * as the domain builds it (coachViewOf: its status, and its standing only
 * where granted, R-155). Internal to the package.
 */
import {
  playerKeys,
  type RepertoireGraph,
  type Side,
  type TrackedReview,
} from '@mychess/chess';
import {
  byName,
  coachViewOf,
  ownScope,
  sharedScope,
  type CoachProgressFacts,
  type CoachView,
  type ProgressRepertoire,
  type ProgressSource,
  type RepertoireScope,
} from '@mychess/domain';
import type { Executor } from '../client';
import { loadRepertoireRows } from '../repertoires/repository';
import { repertoireScope } from '../repertoires/scope';

export interface RepertoireRef {
  readonly id: string;
  readonly name: string;
  readonly side: Side;
}

/** A repertoire with its graph, as a scope reached it. */
export interface LoadedGraph {
  readonly repertoire: RepertoireRef;
  readonly graph: RepertoireGraph;
}

/**
 * Repertoire `id` as `scope` reaches it for viewing, or undefined: 4
 * statements (its row, then the 3 of its graph).
 */
export async function loadVisible(
  tx: Executor,
  scope: RepertoireScope,
  id: string,
): Promise<LoadedGraph | undefined> {
  const loaded = await loadRepertoireRows(
    tx,
    repertoireScope(tx, scope, 'view', id),
  );
  if (loaded === undefined) return undefined;
  const { name, side } = loaded.repertoire;
  return { repertoire: { id, name, side }, graph: loaded.graph };
}

/** By repertoire name in English order, then id. */
export const byRepertoireName = byName((one: LoadedGraph) => one.repertoire);

/** Each of `ids` that `scope` reaches for viewing, by name: 4 statements each. */
export async function loadAllVisible(
  tx: Executor,
  scope: RepertoireScope,
  ids: Iterable<string>,
): Promise<LoadedGraph[]> {
  const out: LoadedGraph[] = [];
  for (const id of ids) {
    const loaded = await loadVisible(tx, scope, id);
    if (loaded !== undefined) out.push(loaded);
  }
  return out.sort(byRepertoireName);
}

/** Every player-move key of the graphs, each once. */
export const keysOf = (graphs: readonly RepertoireGraph[]): string[] => [
  ...new Set(graphs.flatMap((graph) => playerKeys(graph))),
];

/** Whose progress, seen by which coach, on what facts. */
export interface ProgressViewer {
  readonly coachId: string;
  readonly playerId: string;
  readonly facts: CoachProgressFacts;
}

/**
 * The scope an entry of the domain loads through (Q26): the player's share
 * for a shared one, the coach's own repertoires for an assignment, live
 * or forked.
 */
const scopeOf = (
  { source }: Pick<ProgressRepertoire, 'source'>,
  coachId: string,
  playerId: string,
): RepertoireScope =>
  source === 'shared' ? sharedScope(coachId, playerId) : ownScope(coachId);

/** What the reads need of one entry of the domain, as it decided it. */
export interface EntryRead {
  readonly source: ProgressSource;
  readonly scope: RepertoireScope;
  /** The entry's Coach view, as loaded, with the player's Reviews at `now`. */
  readonly coachView: (
    loaded: LoadedGraph,
    tracked: ReadonlyMap<string, TrackedReview>,
    now: Date,
  ) => CoachView;
}

/** One entry of progressRepertoire(s), mapped to what the reads load and show. */
export function entryRead(
  entry: ProgressRepertoire,
  { coachId, playerId }: Pick<ProgressViewer, 'coachId' | 'playerId'>,
): EntryRead {
  return {
    source: entry.source,
    scope: scopeOf(entry, coachId, playerId),
    coachView: ({ repertoire, graph }, tracked, now) =>
      coachViewOf(entry, repertoire, { graph, tracked, now }),
  };
}
