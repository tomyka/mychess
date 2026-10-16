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

const START = positionKey(DEFAULT_POSITION);

/** One chapter being written: its moves by the position they leave. */
interface Walk {
  readonly children: ReadonlyMap<string, readonly RepertoireMove[]>;
  /** Whether the chapter's root has Black to move: ply 0 is then move 1 for Black. */
  readonly blackFirst: boolean;
  /** The full-move number of the root, from the FEN the game is set up with. */
  readonly firstMove: number;
  /** Positions whose continuation is already written. */
  readonly written: Set<string>;
}

/** A FEN's full-move number, its sixth field. */
const fullMoveOf = (fen: string): number => Number(fen.split(' ')[5] ?? '1');

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
 */
function moveText(
  walk: Walk,
  move: RepertoireMove,
  ply: number,
  numbered: boolean,
): string[] {
  const number =
    walk.firstMove + Math.floor((ply + (walk.blackFirst ? 1 : 0)) / 2);
  const white = sideToMove(move.from) === 'w';
  const san = white
    ? `${String(number)}. ${move.san}`
    : numbered
      ? `${String(number)}... ${move.san}`
      : move.san;
  return [san, ...marks(move.arrows, move.circles)];
}

/**
 * The movetext from `key` at `ply`: the first move continues the line, the
 * others become variations. A position already written (a transposition
 * or a repetition) ends the line, so each move is written once. The main
 * continuation is walked before the variations, so a variation that
 * transposes into the main line ends there rather than cutting it short.
 */
function continuation(
  walk: Walk,
  key: string,
  ply: number,
  numbered: boolean,
): string[] {
  if (walk.written.has(key)) return [];
  walk.written.add(key);
  const [main, ...others] = walk.children.get(key) ?? [];
  if (main === undefined) return [];
  const rest = continuation(walk, main.to, ply + 1, others.length > 0);
  const variations = others.map((move) => {
    const line = [
      ...moveText(walk, move, ply, true),
      ...continuation(walk, move.to, ply + 1, false),
    ];
    return `(${line.join(' ')})`;
  });
  return [...moveText(walk, main, ply, numbered), ...variations, ...rest];
}

function childrenIn(
  graph: RepertoireGraph,
  chapterId: string,
): Map<string, RepertoireMove[]> {
  const children = new Map<string, RepertoireMove[]>();
  for (const move of graph.moves) {
    if (move.chapters.includes(chapterId)) {
      const siblings = children.get(move.from);
      if (siblings === undefined) children.set(move.from, [move]);
      else siblings.push(move);
    }
  }
  return children;
}

function game(graph: RepertoireGraph, chapter: Chapter): string {
  const walk: Walk = {
    children: childrenIn(graph, chapter.id),
    blackFirst: sideToMove(chapter.rootKey) === 'b',
    firstMove: fullMoveOf(fenOf(chapter.rootKey)),
    written: new Set(),
  };
  const movetext = [
    ...(chapter.intro === null ? [] : [comment(chapter.intro)]),
    ...continuation(walk, chapter.rootKey, 0, true),
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
  return graph.chapters.map((chapter) => game(graph, chapter)).join('\n\n');
}
