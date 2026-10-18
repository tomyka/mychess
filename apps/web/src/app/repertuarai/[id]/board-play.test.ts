import { legalMoves, START_KEY } from '@mychess/chess';
import { describe, expect, it } from 'vitest';
import { graphOf, LONDON } from '../../../../test/fixtures/repertoires';
import { childBySan, moveNumber, movesBetween } from './board-play';

const GRAPH = graphOf(LONDON);
const PROMOTING = '8/1P6/8/8/8/8/8/k6K w - -';

describe('movesBetween', () => {
  it('finds the one legal move between two squares', () => {
    expect(movesBetween(legalMoves(START_KEY), 'g1', 'f3')).toEqual([
      { orig: 'g1', dest: 'f3', san: 'Nf3', promotion: null },
    ]);
  });

  it('finds every promotion of a pawn reaching the last rank', () => {
    expect(
      movesBetween(legalMoves(PROMOTING), 'b7', 'b8').map((m) => m.san),
    ).toEqual(['b8=N', 'b8=B', 'b8=R', 'b8=Q']);
  });

  it('finds nothing for squares no legal move joins', () => {
    expect(movesBetween(legalMoves(START_KEY), 'e2', 'e5')).toEqual([]);
  });
});

describe('childBySan', () => {
  it('finds the chapter’s move from a position by its SAN', () => {
    expect(childBySan(GRAPH, 'c1', START_KEY, 'd4')?.san).toBe('d4');
    expect(childBySan(GRAPH, 'c1', START_KEY, 'e4')).toBeUndefined();
  });

  it('finds only moves the chapter holds', () => {
    const afterD4 = childBySan(GRAPH, 'c2', START_KEY, 'd4')?.to ?? '';
    expect(childBySan(GRAPH, 'c2', afterD4, 'Nf6')?.san).toBe('Nf6');
    expect(childBySan(GRAPH, 'c2', afterD4, 'd5')).toBeUndefined();
    expect(childBySan(GRAPH, 'c1', afterD4, 'd5')?.san).toBe('d5');
  });
});

describe('moveNumber', () => {
  it('numbers White and Black moves from a root with White to move', () => {
    expect([0, 1, 2, 3].map((ply) => moveNumber(ply, true))).toEqual([
      '1.',
      '1...',
      '2.',
      '2...',
    ]);
  });

  it('numbers from a root with Black to move', () => {
    expect([0, 1, 2].map((ply) => moveNumber(ply, false))).toEqual([
      '1...',
      '2.',
      '2...',
    ]);
  });
});
