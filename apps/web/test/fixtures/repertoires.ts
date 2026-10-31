// Persona repertoires as PGN (docs/personas/u1400.md, 1400-2000.md), for the
// component and feature suites, and a generated repertoire of any size for
// the R-162 limits. Pure data and parsing: no database.
import {
  importPgn,
  legalMoves,
  moveKey,
  sideToMove,
  START_KEY,
  type RepertoireGraph,
  type Side,
} from '@mychess/chess';

/** Rokas's London (White): two chapters, a comment, an arrow, one variation. */
export const LONDON = [
  '[Event "London vs ...d5"]',
  '',
  '{ The London } 1. d4 { Solid [%cal Gc1f4] } d5 2. Bf4 Nf6 3. e3 e6 (3... c5 4. c3) 4. Nf3 *',
  '',
  '[Event "London vs KID"]',
  '',
  '1. d4 Nf6 2. Bf4 g6 3. e3 Bg7 4. Nf3 *',
].join('\n');

/** Gabija's Taimanov (Black): two comments and one nested variation. */
export const TAIMANOV = [
  '[Event "Taimanov"]',
  '',
  '1. e4 c5 2. Nf3 e6 3. d4 cxd4 4. Nxd4 Nc6 5. Nc3 { The main line } Qc7',
  '6. Be3 (6. Be2 a6 7. O-O (7. Be3 Nf6) 7... Nf6) (6. g3 a6) 6... a6',
  '{ Flexible } 7. Qd2 Nf6 *',
].join('\n');

/** The graph `text` imports to, or a thrown error. */
export function graphOf(text: string, side: Side = 'white'): RepertoireGraph {
  const imported = importPgn(text, side);
  if (!imported.ok) throw new Error(imported.refusal.reason);
  return imported.value.graph;
}

/** A move of a generated repertoire and the moves after it. */
interface Line {
  readonly san: string;
  readonly then: Line[];
}

/** A position still to expand: the moves that reach it, and where its replies go. */
interface Frontier {
  readonly path: readonly string[];
  readonly then: Line[];
}

const numbered = (ply: number, san: string): string =>
  `${String(Math.floor(ply / 2) + 1)}${ply % 2 === 0 ? '.' : '...'} ${san}`;

/** `lines` from ply `ply` as PGN movetext: the first line, the others as variations. */
function movetext(lines: readonly Line[], ply: number): string {
  const [first, ...others] = lines;
  if (first === undefined) return '';
  const variations = others.map(
    (line) => `(${numbered(ply, line.san)} ${movetext(line.then, ply + 1)})`,
  );
  return [
    numbered(ply, first.san),
    ...variations,
    movetext(first.then, ply + 1),
  ].join(' ');
}

const treePgn = (tree: readonly Line[]): string => `${movetext(tree, 0)} *`;

/** The position key each frontier path reaches in `graph`. */
function keysOf(graph: RepertoireGraph, frontier: readonly Frontier[]) {
  const to = new Map(graph.moves.map((m) => [moveKey(m.from, m.san), m.to]));
  return frontier.map(({ path }) =>
    path.reduce((key, san) => to.get(moveKey(key, san)) ?? '', START_KEY),
  );
}

/** The replies a white repertoire holds at `key`: one White move, every Black one. */
const repliesAt = (key: string): string[] => {
  const sans = legalMoves(key).map((m) => m.san);
  return sideToMove(key) === 'w' ? sans.slice(0, 1) : sans;
};

/**
 * One White game of exactly `n` moves, for the R-162 limits: grown breadth
 * first, one ply per import, each position expanded once so that every
 * move added is a new one.
 */
export function pgnWithMoves(n: number): string {
  const tree: Line[] = [];
  const expanded = new Set<string>();
  let frontier: Frontier[] = [{ path: [], then: tree }];
  let count = 0;
  while (count < n) {
    const keys =
      tree.length === 0
        ? [START_KEY]
        : keysOf(graphOf(treePgn(tree)), frontier);
    const next: Frontier[] = [];
    frontier.forEach((node, i) => {
      const key = keys[i] ?? '';
      if (expanded.has(key)) return;
      expanded.add(key);
      for (const san of repliesAt(key).slice(0, n - count)) {
        const line: Line = { san, then: [] };
        node.then.push(line);
        next.push({ path: [...node.path, san], then: line.then });
        count++;
      }
    });
    frontier = next;
  }
  const pgn = treePgn(tree);
  const moves = graphOf(pgn).moves.length;
  if (moves !== n) throw new Error(`pgnWithMoves: ${String(moves)} moves`);
  return pgn;
}
