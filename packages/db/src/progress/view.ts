/**
 * What the coach progress reads show, built from what they loaded: the
 * repertoires a coach may see progress on (each with its graph), their
 * player-move keys, and one mapping of each entry the domain decided
 * (entryRead): the scope it loads through, its S5 badges (coachBadges,
 * shared with coachAssignments), and its standing only where granted
 * (R-155: none for a forked assignment). Internal to the package.
 */
import { byName } from '@mychess/domain';
import {
  playerKeys,
  repertoireStanding,
  type RepertoireGraph,
  type Side,
  type Standing,
  type TrackedReview,
} from '@mychess/chess';
import {
  ownScope,
  sharedScope,
  type BadgeSet,
  type CoachProgressFacts,
  type ProgressRepertoire,
  type ProgressSource,
  type RepertoireScope,
} from '@mychess/domain';
import { coachBadges } from '../assignments/badges';
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

/** By repertoire name in Lithuanian order, then id. */
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

/** What a row or cell shows of a repertoire: its standing, or that it is forked (R-155). */
export type ProgressView =
  | { readonly kind: 'granted'; readonly standing: Standing }
  | { readonly kind: 'forked' };

const FORKED: ProgressView = { kind: 'forked' };

/** A graph with the player's Reviews on its moves, as of `now`. */
interface Reviewed {
  readonly graph: RepertoireGraph;
  readonly tracked: ReadonlyMap<string, TrackedReview>;
  readonly now: Date;
}

/** What the reads need of one entry of the domain, as it decided it. */
export interface EntryRead {
  readonly source: ProgressSource;
  readonly scope: RepertoireScope;
  /** The S5 badges of the entry's assignment; null for a shared one. */
  readonly badges: (reviewed: Reviewed) => BadgeSet | null;
  /** Its standing only where the entry is granted; forked otherwise. */
  readonly view: (reviewed: Reviewed) => ProgressView;
}

/** One entry of progressRepertoire(s), mapped to what the reads load and show. */
export function entryRead(
  entry: ProgressRepertoire,
  { coachId, playerId }: Pick<ProgressViewer, 'coachId' | 'playerId'>,
): EntryRead {
  const { assignment } = entry;
  return {
    source: entry.source,
    scope: scopeOf(entry, coachId, playerId),
    badges: ({ graph, tracked, now }) =>
      assignment === null ? null : coachBadges(assignment, graph, tracked, now),
    view: ({ graph, tracked, now }) =>
      entry.kind === 'granted'
        ? {
            kind: 'granted',
            standing: repertoireStanding(graph, tracked, now),
          }
        : FORKED,
  };
}
