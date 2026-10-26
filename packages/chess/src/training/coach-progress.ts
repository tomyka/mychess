/**
 * Where a player stands on a repertoire, as their coach sees it: each own
 * move in exactly one state (R-151), counted for the repertoire, each
 * chapter and each of its lines (R-152), with Mastered (R-56) on each.
 * Reviews of moves the graph does not hold (dormant) never count.
 */
import { sideToMove } from '../position-key';
import {
  isPlayerMove,
  moveKey,
  type Chapter,
  type RepertoireGraph,
  type RepertoireMove,
} from '../repertoire/graph';
import { chapterWalks, type ChapterWalk } from '../repertoire/walk';
import { mastered } from './progress';
import { isDue, type ReviewState } from './schedule';
import { unreviewed } from './stored-review';

/** R-151: the one state the coach sees a move in. */
export type MoveState = 'notStarted' | 'skipped' | 'due' | 'learned';

/** A player's Review of a move, and whether it entered by "I know this". */
export interface TrackedReview {
  readonly review: ReviewState;
  readonly skipped: boolean;
}

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

/**
 * R-151: due once the Review is due (a skipped move's first Review
 * included); skipped while "I know this" was never graded since; else
 * learned.
 */
export function moveState(
  tracked: TrackedReview | undefined,
  now: Date,
): MoveState {
  if (tracked === undefined) return 'notStarted';
  if (isDue(tracked.review, now)) return 'due';
  return tracked.skipped && unreviewed(tracked.review) ? 'skipped' : 'learned';
}

/** Moves with a Review, as a whole percentage; null with no own moves. */
export function percentLearned(counts: ProgressCounts): number | null {
  const started = counts.skipped + counts.due + counts.learned;
  const total = started + counts.notStarted;
  return total === 0 ? null : Math.round((started / total) * 100);
}

/** What every standing is read from. */
interface Reading {
  readonly reviews: ReadonlyMap<string, TrackedReview>;
  readonly states: ReadonlyMap<string, ReviewState>;
  readonly now: Date;
}

const readingOf = (
  reviews: ReadonlyMap<string, TrackedReview>,
  now: Date,
): Reading => ({
  reviews,
  states: new Map([...reviews].map(([key, t]) => [key, t.review])),
  now,
});

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
    mastered: mastered({ kind: 'moves', keys }, reading.states, reading.now),
  };
}

/** The own-move keys of `moves`, each once, in order. */
const ownKeys = (
  graph: RepertoireGraph,
  moves: readonly RepertoireMove[],
): string[] => [
  ...new Set(
    moves
      .filter((m) => isPlayerMove(graph, m))
      .map((m) => moveKey(m.from, m.san)),
  ),
];

/** The repertoire's own-move keys, each once. */
const allOwnKeys = (graph: RepertoireGraph): string[] =>
  ownKeys(graph, graph.moves);

/** The whole repertoire's standing: what the player page and grid show. */
export function repertoireStanding(
  graph: RepertoireGraph,
  reviews: ReadonlyMap<string, TrackedReview>,
  now: Date,
): Standing {
  return standingOf(allOwnKeys(graph), readingOf(reviews, now));
}

function chapterProgress(
  graph: RepertoireGraph,
  chapter: Chapter,
  walk: ChapterWalk,
  reading: Reading,
): ChapterProgress {
  const lines = walk.paths().flatMap((path): LineProgress[] => {
    const keys = ownKeys(graph, path);
    return keys.length === 0
      ? []
      : [{ sans: path.map((m) => m.san), ...standingOf(keys, reading) }];
  });
  return {
    chapter,
    whiteFirst: sideToMove(chapter.rootKey) === 'w',
    ...standingOf(ownKeys(graph, walk.moves()), reading),
    lines,
  };
}

/**
 * The drill-down of R-152: the repertoire, each chapter in order, and each
 * line of the chapter's tree (`paths`, linear in the chapter's size) that
 * holds an own move.
 */
export function progressOf(
  graph: RepertoireGraph,
  reviews: ReadonlyMap<string, TrackedReview>,
  now: Date,
): RepertoireProgress {
  const reading = readingOf(reviews, now);
  const walks = chapterWalks(graph);
  return {
    ...standingOf(allOwnKeys(graph), reading),
    chapters: graph.chapters.map((c) =>
      chapterProgress(graph, c, walks(c.id), reading),
    ),
  };
}
