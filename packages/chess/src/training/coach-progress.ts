/**
 * Where a player stands on a repertoire, as their coach sees it: each
 * player move in exactly one state (R-151), counted for the repertoire, each
 * chapter and each of its lines (R-152), with Mastered (R-56, R-178) on
 * each and the share learned (R-177).
 * Reviews of moves the graph does not hold (dormant) never count.
 */
import { sideToMove } from '../position-key';
import {
  isPlayerMove,
  moveKey,
  playerKeys,
  type Chapter,
  type RepertoireGraph,
  type RepertoireMove,
} from '../repertoire/graph';
import { chapterWalks, type ChapterWalk } from '../repertoire/walk';
import { moveState, type MoveState, type TrackedReview } from './move-state';
import { mastered } from './progress';

export type ProgressCounts = Readonly<Record<MoveState, number>>;

/** A set of moves' counts and whether it is mastered. */
export interface Standing {
  readonly counts: ProgressCounts;
  readonly mastered: boolean;
}

/** One line of a chapter: its moves' SAN from the chapter root. */
export interface LineProgress extends Standing {
  readonly sans: readonly string[];
}

export interface ChapterProgress extends Standing {
  readonly chapter: Chapter;
  /** White moves first from the chapter root (for move numbers). */
  readonly whiteFirst: boolean;
  readonly lines: readonly LineProgress[];
}

export interface RepertoireProgress extends Standing {
  readonly chapters: readonly ChapterProgress[];
}

/** How many player moves the counts cover, in every state. */
export function totalMoves(counts: ProgressCounts): number {
  return counts.notStarted + counts.skipped + counts.due + counts.learned;
}

/**
 * R-177: learned moves (not due, skipped or not started) as a whole
 * percentage of all player moves, matching the learned count; null with no
 * player moves.
 */
export function percentLearned(counts: ProgressCounts): number | null {
  const total = totalMoves(counts);
  return total === 0 ? null : Math.round((counts.learned / total) * 100);
}

/** What every standing is read from. */
interface Reading {
  readonly reviews: ReadonlyMap<string, TrackedReview>;
  readonly now: Date;
}

function standingOf(keys: readonly string[], reading: Reading): Standing {
  const counts: Record<MoveState, number> = {
    notStarted: 0,
    skipped: 0,
    due: 0,
    learned: 0,
  };
  for (const key of keys) {
    counts[moveState(reading.reviews.get(key), reading.now)] += 1;
  }
  return {
    counts,
    mastered: mastered({ kind: 'moves', keys }, reading.reviews, reading.now),
  };
}

/** The player-move keys of `moves`, each once, in order. */
const playerKeysOf = (
  graph: RepertoireGraph,
  moves: readonly RepertoireMove[],
): string[] => [
  ...new Set(
    moves
      .filter((m) => isPlayerMove(graph, m))
      .map((m) => moveKey(m.from, m.san)),
  ),
];

/** The repertoire's player-move keys, each once. */
const allPlayerKeys = (graph: RepertoireGraph): string[] => [
  ...new Set(playerKeys(graph)),
];

/** The whole repertoire's standing: what the player page and grid show. */
export function repertoireStanding(
  graph: RepertoireGraph,
  reviews: ReadonlyMap<string, TrackedReview>,
  now: Date,
): Standing {
  return standingOf(allPlayerKeys(graph), { reviews, now });
}

function chapterProgress(
  graph: RepertoireGraph,
  chapter: Chapter,
  walk: ChapterWalk,
  reading: Reading,
): ChapterProgress {
  const lines = walk.paths().flatMap((path): LineProgress[] => {
    const keys = playerKeysOf(graph, path);
    return keys.length === 0
      ? []
      : [{ sans: path.map((m) => m.san), ...standingOf(keys, reading) }];
  });
  return {
    chapter,
    whiteFirst: sideToMove(chapter.rootKey) === 'w',
    ...standingOf(playerKeysOf(graph, walk.moves()), reading),
    lines,
  };
}

/**
 * The drill-down of R-152: the repertoire, each chapter in order, and each
 * line of the chapter's tree (`paths`, linear in the chapter's size) that
 * holds a player move.
 */
export function progressOf(
  graph: RepertoireGraph,
  reviews: ReadonlyMap<string, TrackedReview>,
  now: Date,
): RepertoireProgress {
  const reading = { reviews, now };
  const walks = chapterWalks(graph);
  return {
    ...standingOf(allPlayerKeys(graph), reading),
    chapters: graph.chapters.map((c) =>
      chapterProgress(graph, c, walks(c.id), reading),
    ),
  };
}
