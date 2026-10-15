import { Chess, type Move } from 'chess.js';
import { fenOf, positionKey } from '../position-key';
import type { Result } from '../result';
import {
  chapterOf,
  isPlayerMove,
  type Chapter,
  type Marks,
  type RepertoireGraph,
  type RepertoireMove,
} from './graph';

/** Why a builder edit was refused; each reason is a message-catalogue key. */
export type EditRefusal =
  | { reason: 'repertoire.unknownChapter' }
  | { reason: 'repertoire.illegalMove' }
  | { reason: 'repertoire.unknownPosition' }
  | { reason: 'repertoire.secondAnswer' }
  | { reason: 'repertoire.unknownMove' };

type EditResult = Result<RepertoireGraph, EditRefusal>;

const refuse = (reason: EditRefusal['reason']): EditResult => ({
  ok: false,
  refusal: { reason },
});

const same = (move: RepertoireMove, fromKey: string, san: string): boolean =>
  move.from === fromKey && move.san === san;

const movesOf = (graph: RepertoireGraph, chapter: Chapter): RepertoireMove[] =>
  graph.moves.filter((m) => m.chapters.includes(chapter.id));

/** The positions a chapter reaches: its root and where each of its moves lands. */
function reachableKeys(graph: RepertoireGraph, chapter: Chapter): Set<string> {
  return new Set([
    chapter.rootKey,
    ...movesOf(graph, chapter).map((m) => m.to),
  ]);
}

function play(fromKey: string, san: string): Move | null {
  try {
    return new Chess(fenOf(fromKey)).move(san);
  } catch {
    return null;
  }
}

function withChapter(
  graph: RepertoireGraph,
  target: RepertoireMove,
  chapterId: string,
): RepertoireGraph {
  if (target.chapters.includes(chapterId)) return graph;
  const chapters = [...target.chapters, chapterId];
  return {
    ...graph,
    moves: graph.moves.map((m) => (m === target ? { ...m, chapters } : m)),
  };
}

function newMove(
  fromKey: string,
  played: Move,
  chapterId: string,
): RepertoireMove {
  return {
    from: fromKey,
    to: positionKey(played.after),
    san: played.san,
    uci: played.from + played.to + (played.promotion ?? ''),
    arrows: [],
    circles: [],
    chapters: [chapterId],
  };
}

/**
 * Adds `san` from `fromKey` to a chapter. The move is stored once per
 * position: a move another chapter already has gains this chapter. The
 * player keeps one answer per position in a repertoire.
 */
export function addMove(
  graph: RepertoireGraph,
  chapterId: string,
  fromKey: string,
  san: string,
): EditResult {
  const chapter = chapterOf(graph, chapterId);
  if (chapter === undefined) return refuse('repertoire.unknownChapter');
  if (!reachableKeys(graph, chapter).has(fromKey))
    return refuse('repertoire.unknownPosition');
  const played = play(fromKey, san);
  if (played === null) return refuse('repertoire.illegalMove');
  const existing = graph.moves.find((m) => same(m, fromKey, played.san));
  if (existing !== undefined)
    return { ok: true, value: withChapter(graph, existing, chapterId) };
  const move = newMove(fromKey, played, chapterId);
  const secondAnswer =
    isPlayerMove(graph, move) &&
    graph.moves.some((m) => m.from === fromKey && isPlayerMove(graph, m));
  if (secondAnswer) return refuse('repertoire.secondAnswer');
  return { ok: true, value: { ...graph, moves: [...graph.moves, move] } };
}

function withoutChapter(
  move: RepertoireMove,
  chapterId: string,
): RepertoireMove {
  return { ...move, chapters: move.chapters.filter((c) => c !== chapterId) };
}

/** The moves a walk from `rootKey` over `moves` can play. */
function reachableFrom(
  rootKey: string,
  moves: readonly RepertoireMove[],
): Set<RepertoireMove> {
  const reached = new Set([rootKey]);
  const kept = new Set<RepertoireMove>();
  let frontier = [rootKey];
  while (frontier.length > 0) {
    const next = moves.filter((m) => !kept.has(m) && frontier.includes(m.from));
    next.forEach((m) => kept.add(m));
    frontier = next.map((m) => m.to).filter((key) => !reached.has(key));
    frontier.forEach((key) => reached.add(key));
  }
  return kept;
}

/** Moves of a chapter its root no longer reaches leave the chapter. */
function prune(graph: RepertoireGraph, chapter: Chapter): RepertoireGraph {
  const kept = reachableFrom(chapter.rootKey, movesOf(graph, chapter));
  const moves = graph.moves.map((m) =>
    kept.has(m) ? m : withoutChapter(m, chapter.id),
  );
  return { ...graph, moves: moves.filter((m) => m.chapters.length > 0) };
}

/**
 * Takes `san` from `fromKey` out of a chapter, with every move of the chapter
 * that only it reached. A move still reachable another way (a transposition)
 * or used by another chapter stays.
 */
export function removeMove(
  graph: RepertoireGraph,
  chapterId: string,
  fromKey: string,
  san: string,
): EditResult {
  const chapter = chapterOf(graph, chapterId);
  if (chapter === undefined) return refuse('repertoire.unknownChapter');
  const moves = graph.moves.map((m) =>
    same(m, fromKey, san) ? withoutChapter(m, chapterId) : m,
  );
  return { ok: true, value: prune({ ...graph, moves }, chapter) };
}

/** Replaces the arrows and circles on one move of a chapter. */
export function setMarks(
  graph: RepertoireGraph,
  chapterId: string,
  at: { readonly from: string; readonly san: string },
  { arrows, circles }: Marks,
): EditResult {
  const chapter = chapterOf(graph, chapterId);
  if (chapter === undefined) return refuse('repertoire.unknownChapter');
  const target = movesOf(graph, chapter).find((m) => same(m, at.from, at.san));
  if (target === undefined) return refuse('repertoire.unknownMove');
  const moves = graph.moves.map((m) =>
    m === target ? { ...m, arrows, circles } : m,
  );
  return { ok: true, value: { ...graph, moves } };
}
