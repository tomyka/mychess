import { Chess, type Move } from 'chess.js';
import { fenOf, positionKey } from '../position-key';
import type { Result } from '../result';
import { normalizeComment } from './comment';
import {
  chapterOf,
  moveKey,
  nextChapterId,
  nextChapterNumber,
  type Chapter,
  type Marks,
  type RepertoireGraph,
  type RepertoireMove,
} from './graph';
import { RepertoireMoves, type PlayedMove } from './moves';
import { renamedByMoves } from './naming';
import { chapterWalks } from './walk';

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

/** The moves a chapter's root reaches. */
const walkedMoves = (graph: RepertoireGraph, chapter: Chapter) =>
  chapterWalks(graph)(chapter.id).moves();

/**
 * The positions a chapter reaches: its root and where each of its moves lands.
 * Every move of a chapter is reachable from its root: `addMove` adds only from
 * a position the chapter reaches, and `removeMove` prunes what its root no
 * longer reaches. So the walk's moves are all of the chapter's moves.
 */
function reachableKeys(graph: RepertoireGraph, chapter: Chapter): Set<string> {
  return new Set([
    chapter.rootKey,
    ...walkedMoves(graph, chapter).map((m) => m.to),
  ]);
}

function play(fromKey: string, san: string): PlayedMove | null {
  let played: Move;
  try {
    played = new Chess(fenOf(fromKey)).move(san);
  } catch {
    return null;
  }
  return {
    from: fromKey,
    to: positionKey(played.after),
    san: played.san,
    uci: played.from + played.to + (played.promotion ?? ''),
  };
}

/**
 * Adds `san` from `fromKey` to a chapter. The move is stored once per
 * position: a move another chapter already has gains this chapter. The
 * player keeps one answer per position in a repertoire. The chapter's name
 * follows its moves (R-104, `renamedByMoves`).
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
  const held = graph.moves.some(
    (m) => same(m, fromKey, played.san) && m.chapters.includes(chapterId),
  );
  if (held) return { ok: true, value: graph };
  const moves = new RepertoireMoves(graph.side, graph.moves);
  const put = moves.put(played, chapterId);
  if (!put.ok) return put;
  const value = { ...graph, moves: moves.list() };
  return { ok: true, value: renamedByMoves(value, chapterId) };
}

function withoutChapter(
  move: RepertoireMove,
  chapterId: string,
): RepertoireMove {
  return { ...move, chapters: move.chapters.filter((c) => c !== chapterId) };
}

/** Moves of a chapter its root no longer reaches leave the chapter. */
function prune(graph: RepertoireGraph, chapter: Chapter): RepertoireGraph {
  const kept = new Set(walkedMoves(graph, chapter));
  const moves = graph.moves.map((m) =>
    kept.has(m) ? m : withoutChapter(m, chapter.id),
  );
  return { ...graph, moves: moves.filter((m) => m.chapters.length > 0) };
}

/**
 * Takes `san` from `fromKey` out of a chapter, with every move of the chapter
 * that only it reached. A move still reachable another way (a transposition)
 * or used by another chapter stays. The chapter's name follows its moves
 * (R-104, `renamedByMoves`).
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
  const value = prune({ ...graph, moves }, chapter);
  return { ok: true, value: renamedByMoves(value, chapterId) };
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
  const target = graph.moves.find(
    (m) => same(m, at.from, at.san) && m.chapters.includes(chapterId),
  );
  if (target === undefined) return refuse('repertoire.unknownMove');
  const moves = graph.moves.map((m) =>
    m === target ? { ...m, arrows, circles } : m,
  );
  return { ok: true, value: { ...graph, moves } };
}

/**
 * Sets the comment of a move (R-102), in the form PGN carries
 * (`normalizeComment`, R-105); blank text removes it. The comment belongs to
 * the move, so every chapter holding the move shows it.
 */
export function editComment(
  graph: RepertoireGraph,
  key: string,
  text: string,
): EditResult {
  const target = graph.moves.find((m) => moveKey(m.from, m.san) === key);
  if (target === undefined) return refuse('repertoire.unknownMove');
  const comment = normalizeComment(text);
  const moves = graph.moves.map((m) => (m === target ? { ...m, comment } : m));
  return { ok: true, value: { ...graph, moves } };
}

/**
 * Removes a chapter and every move only it used. A move another chapter
 * holds stays; that chapter's moves are still reachable from its own root.
 */
export function removeChapter(
  graph: RepertoireGraph,
  chapterId: string,
): EditResult {
  if (chapterOf(graph, chapterId) === undefined)
    return refuse('repertoire.unknownChapter');
  const moves = graph.moves
    .map((m) => withoutChapter(m, chapterId))
    .filter((m) => m.chapters.length > 0);
  const chapters = graph.chapters.filter((c) => c.id !== chapterId);
  return { ok: true, value: { ...graph, chapters, moves } };
}

/**
 * Adds an empty chapter starting at `rootKey`, numbered "Chapter N" until
 * its moves classify (R-104).
 */
export function addChapter(
  graph: RepertoireGraph,
  rootKey: string,
): { readonly graph: RepertoireGraph; readonly chapterId: string } {
  const chapterId = nextChapterId(graph.chapters);
  const chapter: Chapter = {
    id: chapterId,
    rootKey,
    intro: null,
    nameSource: { kind: 'index', number: nextChapterNumber(graph.chapters) },
  };
  const chapters = [...graph.chapters, chapter];
  return { graph: { ...graph, chapters }, chapterId };
}

/** Names a chapter as its owner typed it; the domain checked the name. */
export function renameChapter(
  graph: RepertoireGraph,
  chapterId: string,
  name: string,
): EditResult {
  if (chapterOf(graph, chapterId) === undefined)
    return refuse('repertoire.unknownChapter');
  const chapters = graph.chapters.map((c): Chapter =>
    c.id === chapterId ? { ...c, nameSource: { kind: 'custom', name } } : c,
  );
  return { ok: true, value: { ...graph, chapters } };
}
