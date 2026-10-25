import { describe, expect, it } from 'vitest';
import { importPgn } from '../pgn/import-pgn';
import { moveKey, type RepertoireGraph } from '../repertoire/graph';
import { lineTo } from './line-to';

function graph(pgn: string): RepertoireGraph {
  const r = importPgn(pgn, 'white');
  if (!r.ok) throw new Error(r.refusal.reason);
  return r.value.graph;
}

const g = graph('1. e4 e5 2. Nf3 Nc6 (2... d6 3. d4) 3. Bc4 *');
const sans = (line: ReturnType<typeof lineTo>) => line?.moves.map((m) => m.san);
const keyIn = (graphOf: RepertoireGraph, san: string) => {
  const m = graphOf.moves.find((x) => x.san === san);
  if (m === undefined) throw new Error(san);
  return moveKey(m.from, m.san);
};
const keyOf = (san: string) => keyIn(g, san);

describe('lineTo', () => {
  it('gives the moves before the move, the move last', () => {
    expect(sans(lineTo(g, keyOf('Bc4')))).toEqual([
      'e4',
      'e5',
      'Nf3',
      'Nc6',
      'Bc4',
    ]);
  });
  it('follows the branch the move is on', () => {
    expect(sans(lineTo(g, keyOf('d4')))).toEqual([
      'e4',
      'e5',
      'Nf3',
      'd6',
      'd4',
    ]);
  });
  it('names the chapter and its root', () => {
    const line = lineTo(g, keyOf('e4'));
    expect(line?.chapterId).toBe(g.chapters[0]?.id);
    expect(line?.rootKey).toBe(g.chapters[0]?.rootKey);
    expect(sans(line)).toEqual(['e4']);
  });
  it('is undefined for a key the graph does not hold', () => {
    expect(lineTo(g, 'nowhere|e4')).toBeUndefined();
  });
  it('after a transposition gives the path the walk took first', () => {
    const t = graph('1. e4 e5 (1... Nc6 2. Nf3 e5) 2. Nf3 Nc6 3. Bc4 *');
    expect(sans(lineTo(t, keyIn(t, 'Bc4')))).toEqual([
      'e4',
      'e5',
      'Nf3',
      'Nc6',
      'Bc4',
    ]);
  });
  it('finds a move only the second chapter holds in that chapter', () => {
    // One player move per position: the chapters branch on the opponent's move.
    const two = graph('1. e4 e5 2. Nf3 *\n\n1. e4 c5 2. Nc3 *');
    const second = two.chapters[1];
    expect(second).toBeDefined();
    const line = lineTo(two, keyIn(two, 'Nc3'));
    expect(line?.chapterId).toBe(second?.id);
    expect(line?.rootKey).toBe(second?.rootKey);
    expect(sans(line)).toEqual(['e4', 'c5', 'Nc3']);
  });
});
