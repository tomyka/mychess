/**
 * PGN export of a repertoire: one game per chapter, which `importPgn` reads
 * back into the same moves, marks and chapters.
 */
import { fenOf, sideToMove, START_KEY } from '../position-key';
import type {
  Chapter,
  RepertoireGraph,
  RepertoireMove,
} from '../repertoire/graph';
import { moveNumber } from '../repertoire/notation';
import {
  chapterWalks,
  type ChapterWalk,
  type WalkedMove,
} from '../repertoire/walk';

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

/** How export names a chapter's game; the default is the name source itself. */
export interface ExportOptions {
  readonly title?: (chapter: Chapter) => string;
}

type Title = (chapter: Chapter) => string;

function headers(chapter: Chapter, title: Title): string[] {
  const setUp =
    chapter.rootKey === START_KEY
      ? []
      : ['[SetUp "1"]', `[FEN "${fenOf(chapter.rootKey)}"]`];
  return [`[Event "${tagValue(title(chapter))}"]`, ...setUp, '[Result "*"]'];
}

/** A brace comment; a `}` inside would end it early, so it is dropped. */
const comment = (text: string): string => `{ ${text.replace(/\}/g, '')} }`;

/** A move's comment and marks as one brace comment, or nothing. */
function annotation(move: RepertoireMove): string[] {
  const { arrows, circles } = move;
  const parts = [
    ...(move.comment === null ? [] : [move.comment]),
    ...(arrows.length > 0
      ? [`[%cal ${arrows.map((a) => a.color + a.from + a.to).join(',')}]`]
      : []),
    ...(circles.length > 0
      ? [`[%csl ${circles.map((c) => c.color + c.square).join(',')}]`]
      : []),
  ];
  return parts.length > 0 ? [comment(parts.join(' '))] : [];
}

/**
 * A move with its number: always before a White move, and before a Black
 * move when `numbered` (the start of a line, or after a variation). `ply`
 * counts half-moves from White's first move, so it is `moveNumber`'s ply
 * from a root with White to move.
 */
function moveText(
  move: RepertoireMove,
  ply: number,
  numbered: boolean,
): string[] {
  const white = sideToMove(move.from) === 'w';
  const san =
    white || numbered ? `${moveNumber(ply, true)} ${move.san}` : move.san;
  return [san, ...annotation(move)];
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

function game(walk: ChapterWalk, chapter: Chapter, title: Title): string {
  const movetext = [
    ...(chapter.intro === null ? [] : [comment(chapter.intro)]),
    ...continuation(walk.tree(), firstPly(chapter), true),
    '*',
  ];
  return [...headers(chapter, title), '', movetext.join(' ')].join('\n');
}

/**
 * Writes a repertoire as PGN: one game per chapter, named by an `Event`
 * tag, with a `FEN` tag when the chapter does not start from the initial
 * position, its intro before the first move, each move's comment and its
 * arrows and circles (`[%cal]` / `[%csl]`) in one brace comment, and
 * alternatives as variations. `options.title` names each game; by default
 * the chapter's name source itself.
 */
export function exportPgn(
  graph: RepertoireGraph,
  options: ExportOptions = {},
): string {
  const walks = chapterWalks(graph);
  const title = options.title ?? chapterName;
  return graph.chapters
    .map((chapter) => game(walks(chapter.id), chapter, title))
    .join('\n\n');
}
