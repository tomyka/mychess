import { Chess, type Move } from 'chess.js';
import { positionKey } from '../position-key';
import type { Result } from '../result';
import {
  fenOf,
  isPlayerMove,
  type Marks,
  type RepertoireGraph,
  type RepertoireMove,
} from './graph';

/** Why a builder edit was refused; each reason is a message-catalogue key. */
export type EditRefusal =
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

/** The positions a chapter reaches: its root and where each of its moves lands. */
function reachableKeys(graph: RepertoireGraph, chapterId: string): Set<string> {
  const chapter = graph.chapters.find((c) => c.id === chapterId);
  if (chapter === undefined) return new Set();
  const inChapter = graph.moves.filter((m) => m.chapters.includes(chapterId));
  return new Set([chapter.rootKey, ...inChapter.map((m) => m.to)]);
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
  if (!reachableKeys(graph, chapterId).has(fromKey))
    return refuse('repertoire.unknownPosition');
  const played = play(fromKey, san);
  if (played === null) return refuse('repertoire.illegalMove');
  const existing = graph.moves.find((m) => same(m, fromKey, played.san));
  if (existing !== undefined)
    return { ok: true, value: withChapter(graph, existing, chapterId) };
  const move: RepertoireMove = {
    from: fromKey,
    to: positionKey(played.after),
    san: played.san,
    uci: played.from + played.to + (played.promotion ?? ''),
    arrows: [],
    circles: [],
    chapters: [chapterId],
  };
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

/** Moves of a chapter its root no longer reaches leave the chapter. */
function prune(graph: RepertoireGraph, chapterId: string): RepertoireGraph {
  const root = graph.chapters.find((c) => c.id === chapterId)?.rootKey;
  const reached = new Set<string>(root === undefined ? [] : [root]);
  const kept = new Set<RepertoireMove>();
  const inChapter = graph.moves.filter((m) => m.chapters.includes(chapterId));
  for (let grew = true; grew;) {
    const next = inChapter.filter((m) => !kept.has(m) && reached.has(m.from));
    next.forEach((m) => {
      kept.add(m);
      reached.add(m.to);
    });
    grew = next.length > 0;
  }
  const moves = graph.moves.map((m) =>
    kept.has(m) ? m : withoutChapter(m, chapterId),
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
): RepertoireGraph {
  const moves = graph.moves.map((m) =>
    same(m, fromKey, san) ? withoutChapter(m, chapterId) : m,
  );
  return prune({ ...graph, moves }, chapterId);
}

/** Replaces the arrows and circles on one move. */
export function setMarks(
  graph: RepertoireGraph,
  fromKey: string,
  san: string,
  { arrows, circles }: Marks,
): EditResult {
  const target = graph.moves.find((m) => same(m, fromKey, san));
  if (target === undefined) return refuse('repertoire.unknownMove');
  const moves = graph.moves.map((m) =>
    m === target ? { ...m, arrows, circles } : m,
  );
  return { ok: true, value: { ...graph, moves } };
}
