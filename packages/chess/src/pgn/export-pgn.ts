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
  type WalkedMove,
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
 * move when `numbered` (the start of a line, or after a variation). `ply`
 * counts half-moves from White's first move, so it gives the move number.
 */
function moveText(
  move: RepertoireMove,
  ply: number,
  numbered: boolean,
): string[] {
  const number = 1 + Math.floor(ply / 2);
  const white = sideToMove(move.from) === 'w';
  const san = white
    ? `${String(number)}. ${move.san}`
    : numbered
      ? `${String(number)}... ${move.san}`
      : move.san;
  return [san, ...marks(move.arrows, move.circles)];
}

/**
 * The movetext of `walked` at `ply`: the first move continues the line, the
 * others become variations. The chapter walk takes each move once and ends a
 * line at a position it already walked (a transposition or a repetition), and
 * it walks the main continuation before the variations, so a variation that
 * transposes into the main line ends there rather than cutting it short.
 */
function continuation(
  walked: readonly WalkedMove[],
  ply: number,
  numbered: boolean,
): string[] {
  const [main, ...others] = walked;
  if (main === undefined) return [];
  const variations = others.map((alternative) => {
    const line = [
      ...moveText(alternative.move, ply, true),
      ...continuation(alternative.next, ply + 1, false),
    ];
    return `(${line.join(' ')})`;
  });
  return [
    ...moveText(main.move, ply, numbered),
    ...variations,
    ...continuation(main.next, ply + 1, others.length > 0),
  ];
}

/**
 * The ply of a chapter's first move. Numbering starts at move 1: a position
 * key has no move counters, so the chapter's FEN tag (`fenOf`) says move 1
 * too, and a root with Black to move starts at Black's half of it.
 */
const firstPly = (chapter: Chapter): number =>
  sideToMove(chapter.rootKey) === 'b' ? 1 : 0;

function game(walk: ChapterWalk, chapter: Chapter): string {
  const movetext = [
    ...(chapter.intro === null ? [] : [comment(chapter.intro)]),
    ...continuation(walk.tree(), firstPly(chapter), true),
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
