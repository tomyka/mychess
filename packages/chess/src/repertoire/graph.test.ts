import { describe, expect, it } from 'vitest';
import { fenOf, positionKey } from '../position-key';
import {
  emptyGraph,
  isPlayerMove,
  moveKey,
  parseMoveKey,
  playerKeys,
  splitMoveKey,
  type RepertoireGraph,
} from './graph';

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a value');
  return value;
}

const START = positionKey(
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
);
const AFTER_E4 = positionKey(
  'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
);
const AFTER_E5 = positionKey(
  'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
);
const AFTER_C5 = positionKey(
  'rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
);

const move = (from: string, to: string, san: string, uci: string) => ({
  from,
  to,
  san,
  uci,
  arrows: [],
  circles: [],
  comment: null,
  chapters: ['c1'],
});

const graph: RepertoireGraph = {
  side: 'white',
  chapters: [
    {
      id: 'c1',
      rootKey: START,
      intro: null,
      nameSource: { kind: 'index', number: 1 },
    },
  ],
  moves: [
    move(START, AFTER_E4, 'e4', 'e2e4'),
    move(AFTER_E4, AFTER_E5, 'e5', 'e7e5'),
    move(AFTER_E4, AFTER_C5, 'c5', 'c7c5'),
  ],
};

describe('repertoire graph', () => {
  it('keys a move by its position and SAN', () => {
    expect(moveKey(START, 'e4')).toBe(`${START}|e4`);
  });

  it('splits a move key back into its position key and SAN', () => {
    expect(splitMoveKey(moveKey(START, 'Nf3'))).toEqual({
      fromKey: START,
      san: 'Nf3',
    });
  });

  it.each([
    ['no separator', START],
    ['two separators', `${START}|e4|e5`],
    ['an empty position key', '|e4'],
    ['an empty SAN', `${START}|`],
  ])('throws on a string with %s, which moveKey never makes', (_, key) => {
    expect(() => splitMoveKey(key)).toThrow(`not a move key: ${key}`);
  });

  it('parses a move key into its position key and SAN', () => {
    expect(parseMoveKey(moveKey(START, 'Nf3'))).toEqual({
      fromKey: START,
      san: 'Nf3',
    });
  });

  it.each([
    ['no separator', START],
    ['two separators', `${START}|e4|e5`],
    ['an empty position key', '|e4'],
    ['an empty SAN', `${START}|`],
  ])('parses a string with %s as no move key, without throwing', (_, key) => {
    expect(parseMoveKey(key)).toBeNull();
  });

  it.each(['white', 'black'] as const)(
    'starts an empty %s repertoire with no chapters and no moves',
    (side) => {
      expect(emptyGraph(side)).toEqual({ side, chapters: [], moves: [] });
    },
  );

  it('turns a position key into a FEN chess.js accepts', () => {
    expect(fenOf(START)).toBe(`${START} 0 1`);
  });

  it("knows which moves are the player's", () => {
    expect(isPlayerMove(graph, must(graph.moves[0]))).toBe(true);
    expect(isPlayerMove(graph, must(graph.moves[1]))).toBe(false);
    expect(
      isPlayerMove({ ...graph, side: 'black' }, must(graph.moves[1])),
    ).toBe(true);
  });

  it("lists the review keys of the player's moves only", () => {
    expect(playerKeys(graph)).toEqual([moveKey(START, 'e4')]);
  });
});
