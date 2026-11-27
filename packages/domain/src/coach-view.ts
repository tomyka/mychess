/**
 * The Coach view of a repertoire (docs/CONTEXT.md): what a coach sees of
 * one of a linked player's repertoires, built from the entry the access
 * rules decided (progressRepertoire, Q26): the repertoire, where it comes
 * from, its assignment's status, and its Standing where granted; for a
 * forked assignment only that it is forked, with the player's fork of it
 * when they share that fork (R-155, #328). Every coach read returns it and
 * the coach's rules (attentionOf, playerSummary, playerPageCards) and the
 * one tag rule (coachViewTag) take it as it is.
 */
import {
  repertoireStanding,
  type RepertoireGraph,
  type Side,
  type Standing,
  type TrackedReview,
} from '@mychess/chess';
import { assignmentStatusOf, type AssignmentStatus } from './assignment';
import type { ProgressRepertoire, ProgressSource } from './coach-progress';

/** An assignment's status with its effective deadline (`YYYY-MM-DD`). */
export type CoachRowStatus = AssignmentStatus & {
  readonly deadline: string | null;
};

/** The repertoire a Coach view is of. */
export interface CoachViewRepertoire {
  readonly id: string;
  readonly name: string;
  readonly side: Side;
}

/**
 * What the coach is shown of the repertoire: its standing where granted,
 * or that it is forked (R-155), naming the player's fork of it when they
 * share that fork with this coach (#328), null otherwise.
 */
type CoachViewShows =
  | { readonly kind: 'granted'; readonly standing: Standing }
  | { readonly kind: 'forked'; readonly sharedForkId: string | null };

/** One of a linked player's repertoires as their coach sees it. */
export interface CoachView {
  readonly repertoire: CoachViewRepertoire;
  /** Assigned for a forked assignment too; shared wins (Q26). */
  readonly source: ProgressSource;
  /**
   * The coach's repertoire a shared one is the player's Fork of (#328,
   * R-155); null otherwise.
   */
  readonly forkOf: string | null;
  /** The assignment's deadline and status (R-129); null for a shared one. */
  readonly status: CoachRowStatus | null;
  readonly view: CoachViewShows;
}

/** A repertoire's graph with the player's Reviews by move key, at `now`. */
export interface ReviewedGraph {
  readonly graph: RepertoireGraph;
  readonly tracked: ReadonlyMap<string, TrackedReview>;
  readonly now: Date;
}

/**
 * The Coach view of `entry`, as loaded: its status from its assignment
 * (assignmentStatusOf), its standing only where granted (R-155).
 */
export function coachViewOf(
  entry: ProgressRepertoire,
  repertoire: CoachViewRepertoire,
  { graph, tracked, now }: ReviewedGraph,
): CoachView {
  const { assignment } = entry;
  return {
    repertoire,
    source: entry.source,
    forkOf: entry.source === 'shared' ? entry.forkOf : null,
    status:
      assignment === null
        ? null
        : assignmentStatusOf(assignment, {
            graph,
            tracked: new Set(tracked.keys()),
            now,
          }),
    view:
      entry.kind === 'granted'
        ? { kind: 'granted', standing: repertoireStanding(graph, tracked, now) }
        : { kind: 'forked', sharedForkId: entry.sharedForkId },
  };
}

/**
 * How the coach has the repertoire: their assignment, shared with them
 * (R-42), or the player's Fork of one of the coach's repertoires (R-155,
 * #328).
 */
export type CoachViewTag = 'assigned' | 'shared' | 'fork';

/**
 * The tag of a Coach view, the one rule of the player and progress pages:
 * a forked assignment, or a share that is the player's Fork of the coach's
 * repertoire, is a fork; anything else is tagged by its source.
 */
export const coachViewTag = ({
  source,
  forkOf,
  view,
}: Pick<CoachView, 'source' | 'forkOf' | 'view'>): CoachViewTag =>
  view.kind === 'forked' || forkOf !== null ? 'fork' : source;
