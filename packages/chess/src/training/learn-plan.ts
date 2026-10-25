/**
 * The lines to learn (R-144, R-145): the new moves to learn next, as whole
 * lines from a chapter's root, so each new move is learned in context. The
 * caller orders the repertoires (domain learnOrder) and gives the allowance
 * left today (R-62, R-146).
 *
 * Each path of a chapter's walk tree (`ChapterWalk.paths`) is a candidate
 * line, so each move is learned on the path the walk takes to it.
 * A path through a transposition ends there; the moves after it are on the
 * path the walk took first.
 */
import {
  isPlayerMove,
  moveKey,
  type Chapter,
  type RepertoireGraph,
  type RepertoireMove,
} from '../repertoire/graph';
import { chapterWalks } from '../repertoire/walk';
import type { TrainingRepertoire } from './scope';

/** `known`: a player move learned before, or planned earlier in this plan. */
export type LearnStepKind = 'opponent' | 'known' | 'new';

export interface LearnPlanStep {
  readonly kind: LearnStepKind;
  readonly move: RepertoireMove;
  readonly key: string;
}

export interface LearnLine {
  readonly repertoireId: string;
  readonly chapterId: string;
  readonly rootKey: string;
  /** From the chapter's root; the last step is `new`. */
  readonly steps: readonly LearnPlanStep[];
}

interface Planner {
  /** Keys learned before or planned to learn in this plan. */
  readonly planned: Set<string>;
  /** New moves the allowance still allows. */
  left: number;
}

function stepOf(
  graph: RepertoireGraph,
  move: RepertoireMove,
  planner: Planner,
): LearnPlanStep {
  const key = moveKey(move.from, move.san);
  if (!isPlayerMove(graph, move)) return { kind: 'opponent', move, key };
  if (planner.planned.has(key) || planner.left === 0)
    return { kind: 'known', move, key };
  planner.planned.add(key);
  planner.left -= 1;
  return { kind: 'new', move, key };
}

/** The path's steps up to its last new move; none when it has nothing new. */
function planPath(
  graph: RepertoireGraph,
  path: readonly RepertoireMove[],
  planner: Planner,
): LearnPlanStep[] {
  const steps = path.map((move) => stepOf(graph, move, planner));
  const last = steps.findLastIndex((s) => s.kind === 'new');
  return steps.slice(0, last + 1);
}

interface Candidate {
  readonly repertoire: TrainingRepertoire;
  readonly chapter: Chapter;
  readonly path: readonly RepertoireMove[];
}

function* candidateLines(
  repertoires: readonly TrainingRepertoire[],
): Generator<Candidate> {
  for (const repertoire of repertoires.filter((r) => r.active)) {
    const walks = chapterWalks(repertoire.graph);
    for (const chapter of repertoire.graph.chapters) {
      for (const path of walks(chapter.id).paths())
        yield { repertoire, chapter, path };
    }
  }
}

/**
 * The lines to learn, at most `limit` new moves in all, over the active
 * repertoires in the given order. Keys in `learned` are never planned again.
 */
export function learnPlan(
  repertoires: readonly TrainingRepertoire[],
  learned: ReadonlySet<string>,
  limit: number,
): LearnLine[] {
  const planner: Planner = { planned: new Set(learned), left: limit };
  const plan: LearnLine[] = [];
  for (const { repertoire, chapter, path } of candidateLines(repertoires)) {
    if (planner.left <= 0) break;
    const steps = planPath(repertoire.graph, path, planner);
    if (steps.length > 0)
      plan.push({
        repertoireId: repertoire.id,
        chapterId: chapter.id,
        rootKey: chapter.rootKey,
        steps,
      });
  }
  return plan;
}
