import { describe, expect, it } from 'vitest';
import { importPgn } from '../pgn/import-pgn';
import { moveKey, type RepertoireGraph, type Side } from '../repertoire/graph';
import { trackedIn } from './training';

function graph(pgn: string, side: Side): RepertoireGraph {
  const r = importPgn(pgn, side);
  if (!r.ok) throw new Error(r.refusal.reason);
  return r.value.graph;
}
const keyOf = (g: RepertoireGraph, san: string): string => {
  const m = g.moves.find((x) => x.san === san);
  if (m === undefined) throw new Error(san);
  return moveKey(m.from, m.san);
};

const white = graph('1. e4 e5 2. Nf3 Nc6 *', 'white');
const other = graph('1. d4 d5 2. c4 *', 'white');

describe('trackedIn', () => {
  it('keeps the tracked keys that are player moves of the graph, in order', () => {
    const tracked = [
      keyOf(other, 'd4'),
      keyOf(white, 'Nf3'),
      keyOf(other, 'c4'),
      keyOf(white, 'e4'),
    ];
    expect(trackedIn(white, tracked)).toEqual([
      keyOf(white, 'Nf3'),
      keyOf(white, 'e4'),
    ]);
  });
  it('reads a set of tracked keys in its order', () => {
    const tracked = new Set([keyOf(white, 'Nf3'), keyOf(white, 'e4')]);
    expect(trackedIn(white, tracked)).toEqual([
      keyOf(white, 'Nf3'),
      keyOf(white, 'e4'),
    ]);
  });
  it('leaves out the opponent’s moves of the graph', () => {
    expect(trackedIn(white, [keyOf(white, 'e5'), keyOf(white, 'e4')])).toEqual([
      keyOf(white, 'e4'),
    ]);
  });
  it('is empty with nothing tracked, or nothing of the graph', () => {
    expect(trackedIn(white, [])).toEqual([]);
    expect(trackedIn(white, [keyOf(other, 'd4')])).toEqual([]);
  });
});
