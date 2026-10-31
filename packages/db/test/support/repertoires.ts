import {
  emptyGraph,
  importPgn,
  legalMoves,
  moveKey,
  sideToMove,
  START_KEY,
  type RepertoireGraph,
  type Side,
} from '@mychess/chess';
import { createRepertoire, type Executor, type NewRepertoire } from '../../src';
import { repertoires } from '../../src/schema';

export const T0 = new Date('2026-10-17T08:00:00Z');
export const T1 = new Date('2026-10-17T09:00:00Z');

/** The graph `text` imports to, or a thrown error. */
export function graphOf(text: string, side: Side = 'white'): RepertoireGraph {
  const r = importPgn(text, side);
  if (!r.ok) throw new Error(r.refusal.reason);
  return r.value.graph;
}

/** A new repertoire's id, or a thrown error when a limit refuses it (R-162). */
export async function newRepertoire(
  db: Executor,
  input: NewRepertoire,
): Promise<string> {
  const created = await createRepertoire(db, input);
  if (!created.ok) throw new Error(created.refusal.reason);
  return created.value;
}

/** `graph` with each move's chapters sorted, for comparing as sets. */
export function canonical(graph: RepertoireGraph): RepertoireGraph {
  return {
    ...graph,
    moves: graph.moves.map((m) => ({ ...m, chapters: [...m.chapters].sort() })),
  };
}

export const LONDON = [
  '[Event "London vs ...d5"]',
  '',
  '{ The London } 1. d4 { Solid [%cal Gc1f4] } d5 2. Bf4 Nf6 3. e3 e6 (3... c5 4. c3) 4. Nf3 *',
  '',
  '[Event "London vs KID"]',
  '',
  '1. d4 Nf6 2. Bf4 g6 3. e3 Bg7 4. Nf3 *',
].join('\n');

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

const treeGraph = (tree: readonly Line[]): RepertoireGraph =>
  tree.length === 0 ? emptyGraph('white') : graphOf(`${movetext(tree, 0)} *`);

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
 * A white repertoire of exactly `n` moves in one chapter, for the R-162
 * limits: grown breadth first, one ply per importPgn, each position
 * expanded once so that every move added is a new one.
 */
export function graphWithMoves(n: number): RepertoireGraph {
  const tree: Line[] = [];
  const expanded = new Set<string>();
  let frontier: Frontier[] = [{ path: [], then: tree }];
  let count = 0;
  while (count < n) {
    const keys = keysOf(treeGraph(tree), frontier);
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
  const graph = treeGraph(tree);
  if (graph.moves.length !== n)
    throw new Error(`graphWithMoves: ${String(graph.moves.length)} moves`);
  return graph;
}

/** `count` empty repertoires of `ownerId`, written directly, to fill the R-162 limit. */
export async function seedRepertoireRows(
  db: Executor,
  ownerId: string,
  count: number,
): Promise<void> {
  await db.insert(repertoires).values(
    Array.from({ length: count }, (_, i) => ({
      ownerAccountId: ownerId,
      side: 'white' as const,
      name: `Repertuaras ${String(i + 1)}`,
      createdAt: T0,
      updatedAt: T0,
    })),
  );
}
