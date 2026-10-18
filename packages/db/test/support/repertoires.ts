import { importPgn, type RepertoireGraph, type Side } from '@mychess/chess';

export const T0 = new Date('2026-10-17T08:00:00Z');
export const T1 = new Date('2026-10-17T09:00:00Z');

/** The graph `text` imports to, or a thrown error. */
export function graphOf(text: string, side: Side = 'white'): RepertoireGraph {
  const r = importPgn(text, side);
  if (!r.ok) throw new Error(r.refusal.reason);
  return r.value.graph;
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
