/**
 * What the coach progress reads show, built from what they loaded: the
 * repertoires a coach may see progress on (each with its graph), their
 * player-move keys, the S5 badges of an assignment, and the standing only
 * where canCoachSeeProgress allows it (R-155: none for a forked
 * assignment). Internal to the package.
 */
import {
  allLearned,
  playerKeys,
  repertoireStanding,
  type RepertoireGraph,
  type Side,
  type Standing,
  type TrackedReview,
} from '@mychess/chess';
import {
  canCoachSeeProgress,
  coachAssignmentBadges,
  type AssignmentFacts,
  type BadgeSet,
  type CoachProgressFacts,
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

/** By name in Lithuanian order, then id. */
const byName = (a: LoadedGraph, b: LoadedGraph): number =>
  a.repertoire.name.localeCompare(b.repertoire.name, 'lt') ||
  a.repertoire.id.localeCompare(b.repertoire.id);

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
  return out.sort(byName);
}

/** Every player-move key of the graphs, each once. */
export const keysOf = (graphs: readonly RepertoireGraph[]): string[] => [
  ...new Set(graphs.flatMap((graph) => playerKeys(graph))),
];

/** An assignment's badges as the coach sees them; done when all are learned. */
export const coachBadges = (
  facts: AssignmentFacts,
  graph: RepertoireGraph,
  tracked: ReadonlyMap<string, TrackedReview>,
  now: Date,
): BadgeSet =>
  coachAssignmentBadges(facts, {
    done: allLearned(graph, new Set(tracked.keys())),
    now,
  });

/** Whose progress, seen by which coach, on what facts. */
export interface ProgressViewer {
  readonly coachId: string;
  readonly playerId: string;
  readonly facts: CoachProgressFacts;
}

/**
 * The standing of `loaded` to show `viewer`: only where
 * canCoachSeeProgress allows it, null otherwise (a forked assignment,
 * R-155).
 */
export const standingFor = (
  viewer: ProgressViewer,
  loaded: LoadedGraph,
  tracked: ReadonlyMap<string, TrackedReview>,
  now: Date,
): Standing | null =>
  canCoachSeeProgress(
    viewer.coachId,
    viewer.playerId,
    loaded.repertoire.id,
    viewer.facts,
  ).ok
    ? repertoireStanding(loaded.graph, tracked, now)
    : null;
