/**
 * PGN export of a repertoire: one game per chapter, which `importPgn` reads
 * back into the same moves, marks and chapters.
 */
import { DEFAULT_POSITION } from 'chess.js';
import { fenOf, positionKey, sideToMove } from '../position-key';
import type {
  Arrow,
  Chapter,
  Circle,
  RepertoireGraph,
  RepertoireMove,
} from '../repertoire/graph';
import {
  chapterWalks,
  type ChapterWalk,
  type WalkNode,
} from '../repertoire/walk';

const START = positionKey(DEFAULT_POSITION);

function chapterName(chapter: Chapter): string {
  const source = chapter.nameSource;
  switch (source.kind) {
    case 'custom':
    case 'header':
      return source.name;
    case 'eco':
      return source.eco;
    case 'index':
      return `Chapter ${String(source.number)}`;
  }
}

const tagValue = (value: string): string => value.replace(/[\\"]/g, '\\$&');

function headers(chapter: Chapter): string[] {
  const setUp =
    chapter.rootKey === START
      ? []
      : ['[SetUp "1"]', `[FEN "${fenOf(chapter.rootKey)}"]`];
  return [
    `[Event "${tagValue(chapterName(chapter))}"]`,
    ...setUp,
    '[Result "*"]',
  ];
}

/** A brace comment; a `}` inside would end it early, so it is dropped. */
const comment = (text: string): string => `{ ${text.replace(/\}/g, '')} }`;

function marks(arrows: readonly Arrow[], circles: readonly Circle[]): string[] {
  const commands = [
    ...(arrows.length > 0
      ? [`[%cal ${arrows.map((a) => a.color + a.from + a.to).join(',')}]`]
      : []),
    ...(circles.length > 0
      ? [`[%csl ${circles.map((c) => c.color + c.square).join(',')}]`]
      : []),
  ];
  return commands.length > 0 ? [comment(commands.join(' '))] : [];
}

/**
 * A move with its number: always before a White move, and before a Black
 * move when `numbered` (the start of a line, or after a variation).
 * `blackFirst` says the chapter's root has Black to move: ply 0 is then
 * move 1 for Black.
 */
function moveText(
  blackFirst: boolean,
  move: RepertoireMove,
  ply: number,
  numbered: boolean,
): string[] {
  // Numbering starts at 1: a position key has no move counters, so the
  // chapter's FEN tag (`fenOf`) gives the full-move number 1 too.
  const number = 1 + Math.floor((ply + (blackFirst ? 1 : 0)) / 2);
  const white = sideToMove(move.from) === 'w';
  const san = white
    ? `${String(number)}. ${move.san}`
    : numbered
      ? `${String(number)}... ${move.san}`
      : move.san;
  return [san, ...marks(move.arrows, move.circles)];
}

/**
 * The movetext of `nodes` at `ply`: the first move continues the line, the
 * others become variations. The chapter walk takes each move once and ends a
 * line at a position it already walked (a transposition or a repetition), and
 * it walks the main continuation before the variations, so a variation that
 * transposes into the main line ends there rather than cutting it short.
 */
function continuation(
  blackFirst: boolean,
  nodes: readonly WalkNode[],
  ply: number,
  numbered: boolean,
): string[] {
  const [main, ...others] = nodes;
  if (main === undefined) return [];
  const variations = others.map((node) => {
    const line = [
      ...moveText(blackFirst, node.move, ply, true),
      ...continuation(blackFirst, node.next, ply + 1, false),
    ];
    return `(${line.join(' ')})`;
  });
  return [
    ...moveText(blackFirst, main.move, ply, numbered),
    ...variations,
    ...continuation(blackFirst, main.next, ply + 1, others.length > 0),
  ];
}

function game(walk: ChapterWalk, chapter: Chapter): string {
  const blackFirst = sideToMove(chapter.rootKey) === 'b';
  const movetext = [
    ...(chapter.intro === null ? [] : [comment(chapter.intro)]),
    ...continuation(blackFirst, walk.tree(), 0, true),
    '*',
  ];
  return [...headers(chapter), '', movetext.join(' ')].join('\n');
}

/**
 * Writes a repertoire as PGN: one game per chapter, named by an `Event`
 * tag, with a `FEN` tag when the chapter does not start from the initial
 * position, its intro before the first move, arrows and circles as
 * `[%cal]` / `[%csl]` comments, and alternatives as variations.
 */
export function exportPgn(graph: RepertoireGraph): string {
  const walks = chapterWalks(graph);
  return graph.chapters
    .map((chapter) => game(walks(chapter.id), chapter))
    .join('\n\n');
}
