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
 *
 * A focus (R-206) plans one chapter instead, or one line of it: then the
 * candidate is that line as `lines` gives it, as "I know this" names it.
 */
import {
  isPlayerMove,
  moveKey,
  type Chapter,
  type RepertoireGraph,
  type RepertoireMove,
} from '../repertoire/graph';
import { chapterWalks, type ChapterWalk } from '../repertoire/walk';
import type { TrainingRepertoire } from './scope';

/** `known`: a player move tracked before, or planned earlier in this plan. */
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
  /** Keys tracked before or planned to learn in this plan. */
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

/**
 * One chapter, or one line of it, to learn instead of the learn order
 * (R-206). `lineIndex` is the line's index in `lines(graph, chapterId)`,
 * as the repertoire page names a line for "I know this" (R-58).
 */
export interface LearnFocus {
  readonly repertoireId: string;
  readonly chapterId: string;
  readonly lineIndex?: number;
}

/** Does training plan `repertoire`: active, and the focus's if there is one? */
const planned = (
  repertoire: TrainingRepertoire,
  focus: LearnFocus | undefined,
): boolean =>
  repertoire.active &&
  (focus === undefined || repertoire.id === focus.repertoireId);

/** The chapters of a planned repertoire the focus allows: all, without one. */
const chaptersIn = (
  repertoire: TrainingRepertoire,
  focus: LearnFocus | undefined,
): readonly Chapter[] =>
  focus === undefined
    ? repertoire.graph.chapters
    : repertoire.graph.chapters.filter((c) => c.id === focus.chapterId);

/** The chapter's candidate paths: its walk's paths, or the one focused line. */
function pathsOf(
  walk: ChapterWalk,
  lineIndex: number | undefined,
): readonly (readonly RepertoireMove[])[] {
  if (lineIndex === undefined) return walk.paths();
  const line = walk.lines()[lineIndex];
  return line === undefined ? [] : [line];
}

function* candidateLines(
  repertoires: readonly TrainingRepertoire[],
  focus: LearnFocus | undefined,
): Generator<Candidate> {
  for (const repertoire of repertoires.filter((r) => planned(r, focus))) {
    const walks = chapterWalks(repertoire.graph);
    for (const chapter of chaptersIn(repertoire, focus)) {
      for (const path of pathsOf(walks(chapter.id), focus?.lineIndex))
        yield { repertoire, chapter, path };
    }
  }
}

/**
 * The lines to learn, at most `limit` new moves in all, over the active
 * repertoires in the given order, or only the `focus` chapter or line
 * (R-206). Keys in `tracked` are never planned again.
 */
export function learnPlan(
  repertoires: readonly TrainingRepertoire[],
  tracked: ReadonlySet<string>,
  limit: number,
  focus?: LearnFocus,
): LearnLine[] {
  const planner: Planner = { planned: new Set(tracked), left: limit };
  const plan: LearnLine[] = [];
  for (const { repertoire, chapter, path } of candidateLines(
    repertoires,
    focus,
  )) {
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
