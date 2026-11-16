/**
 * The persona docs' repertoire lines (docs/personas/*.md, the ```pgn
 * fences) as PGN the app's own import reads, and the review keys of their
 * moves. Pure: no database.
 */
import {
  importPgn,
  isPlayerMove,
  mainLine,
  moveKey,
  type ImportedRepertoire,
  type RepertoireGraph,
  type Side,
} from '@mychess/chess';
import type { PersonaKey } from './accounts';

/**
 * The persona PGN files G-M1-2 and D-M1-2 import, in
 * packages/chess/src/pgn/fixtures (one committed copy, #335).
 */
export type PersonaPgnFile = 'persona-taimanov.pgn' | 'persona-katalonu.pgn';

/** One chapter: its name and its lines, each movetext from the start. */
export interface ChapterLines {
  readonly name: string;
  /** Lines such as `1. e4 e5 2. Nf3`; several make one game with variations. */
  readonly lines: readonly string[];
}

/** A chapter of one line. */
export const chapter = (name: string, line: string): ChapterLines => ({
  name,
  lines: [line],
});

/** A persona repertoire as its doc gives it. */
export interface PersonaRepertoire {
  /** How the other definitions name it. */
  readonly handle: string;
  readonly owner: PersonaKey;
  readonly side: Side;
  readonly name: string;
  readonly chapters: readonly ChapterLines[];
  /**
   * The persona's own PGN file the doc says they imported (with comments
   * and NAGs), which the seed imports instead of the bare `chapters`.
   */
  readonly pgnFile?: PersonaPgnFile;
}

/** A move and the moves after it, merged across a chapter's lines. */
interface Branch {
  readonly san: string;
  readonly then: Branch[];
}

/** The SAN moves of a line, without its move numbers. */
const sansOf = (line: string): string[] =>
  line.split(/\s+/).filter((token) => token !== '' && !/^\d+\./.test(token));

function addLine(tree: Branch[], sans: readonly string[]): void {
  let level = tree;
  for (const san of sans) {
    let branch = level.find((b) => b.san === san);
    if (branch === undefined) {
      branch = { san, then: [] };
      level.push(branch);
    }
    level = branch.then;
  }
}

const numbered = (ply: number, san: string): string =>
  `${String(Math.floor(ply / 2) + 1)}${ply % 2 === 0 ? '.' : '...'} ${san}`;

/** `tree` from ply `ply` as movetext: the first branch, the others as variations. */
function movetext(tree: readonly Branch[], ply: number): string {
  const [first, ...others] = tree;
  if (first === undefined) return '';
  const variations = others.map(
    (b) =>
      `(${[numbered(ply, b.san), movetext(b.then, ply + 1)].join(' ').trim()})`,
  );
  return [
    numbered(ply, first.san),
    ...variations,
    movetext(first.then, ply + 1),
  ]
    .join(' ')
    .trim();
}

function chapterGame({ name, lines }: ChapterLines): string {
  const tree: Branch[] = [];
  for (const line of lines) addLine(tree, sansOf(line));
  return `[Event "${name}"]\n\n${movetext(tree, 0)} *`;
}

/** The PGN of a repertoire: one game per chapter, named by its Event header. */
export function repertoirePgn(chapters: readonly ChapterLines[]): string {
  return chapters.map(chapterGame).join('\n\n');
}

/**
 * A repertoire as the app's PGN import makes it, with each chapter's id by
 * its doc label: the import names a chapter after its ECO position when
 * it has one, so the label survives only here.
 */
export interface ImportedChapters {
  /** As importPgn gives it, for an `import` change of an existing repertoire. */
  readonly imported: ImportedRepertoire;
  readonly graph: RepertoireGraph;
  readonly chapterIds: ReadonlyMap<string, string>;
}

/**
 * What the app's PGN import makes of `pgn`, its games named `names` in
 * file order. Throws when it refuses the file or leaves out any move.
 */
function importWhole(
  pgn: string,
  side: Side,
  names: readonly string[],
): ImportedChapters {
  const imported = importPgn(pgn, side);
  if (!imported.ok) throw new Error(`persona PGN: ${imported.refusal.reason}`);
  const { graph, skipped } = imported.value;
  const [first] = skipped;
  if (first !== undefined) {
    const chapter = names[first.game - 1] ?? '?';
    throw new Error(`persona PGN: ${chapter}: ${first.reason}`);
  }
  // With nothing left out, every game made one chapter, in file order.
  return {
    imported: imported.value,
    graph,
    chapterIds: new Map(names.map((n, i) => [n, graph.chapters[i]?.id ?? ''])),
  };
}

/**
 * What the app's PGN import makes of `chapters`. Throws when it refuses
 * the file or leaves out any move (an illegal move, a second answer,
 * R-54): seed lines are copied from the docs, so that is a typo.
 */
export function importChapters(
  side: Side,
  chapters: readonly ChapterLines[],
): ImportedChapters {
  return importWhole(
    repertoirePgn(chapters),
    side,
    chapters.map((c) => c.name),
  );
}

/**
 * The Event headers of a PGN file's games, in file order. Read from the
 * text, not the graph: the import renames a chapter whose main line
 * reaches an ECO position after that position (taxonomyNamed), so the
 * graph keeps no header name for most chapters.
 */
const eventsOf = (pgn: string): string[] =>
  [...pgn.matchAll(/^\[Event "([^"]*)"\]/gm)].map((m) => m[1] ?? '');

/**
 * What the app's PGN import makes of a persona's own PGN file `pgn`, with
 * its comments, NAGs and arrows, as the persona imported it. The file must
 * hold the doc's `chapters` in order, one game each named by its label,
 * and every move of their lines (it may hold more: variations the doc's
 * fences leave out); otherwise the file and the doc have drifted, and
 * this throws.
 */
export function importChaptersFromPgn(
  side: Side,
  chapters: readonly ChapterLines[],
  pgn: string,
): ImportedChapters {
  const names = chapters.map((c) => c.name);
  const events = eventsOf(pgn);
  if (events.join('\n') !== names.join('\n'))
    throw new Error(
      `persona PGN: games ${events.join(', ')} are not the doc's`,
    );
  const file = importWhole(pgn, side, names);
  const inFile = new Set(file.graph.moves.map((m) => moveKey(m.from, m.san)));
  const missing = importChapters(side, chapters).graph.moves.find(
    (m) => !inFile.has(moveKey(m.from, m.san)),
  );
  if (missing !== undefined)
    throw new Error(`persona PGN: the file has no ${missing.san} the doc has`);
  return file;
}

function chapterId({ chapterIds }: ImportedChapters, name: string): string {
  const id = chapterIds.get(name);
  if (id === undefined) throw new Error(`no chapter "${name}"`);
  return id;
}

/** The review keys of the player's moves in chapter `name`, in graph order. */
export function chapterKeys(
  imported: ImportedChapters,
  name: string,
): string[] {
  const id = chapterId(imported, name);
  const { graph } = imported;
  return graph.moves
    .filter((m) => m.chapters.includes(id) && isPlayerMove(graph, m))
    .map((m) => moveKey(m.from, m.san));
}

/**
 * The key of move `at` (`4.c3` for White's fourth move, `9...Be7` for
 * Black's ninth) on the main line of chapter `name`; throws when the main
 * line has no such move.
 */
export function moveKeyAt(
  imported: ImportedChapters,
  name: string,
  at: string,
): string {
  const parsed = /^(\d+)(\.\.\.|\.)(\S+)$/.exec(at);
  const ply =
    parsed === null
      ? -1
      : (Number(parsed[1]) - 1) * 2 + (parsed[2] === '.' ? 0 : 1);
  const move = mainLine(imported.graph, chapterId(imported, name))[ply];
  if (move?.san !== parsed?.[3] || move === undefined)
    throw new Error(`no move ${at} in chapter "${name}"`);
  return moveKey(move.from, move.san);
}
