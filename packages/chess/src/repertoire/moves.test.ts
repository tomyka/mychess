import { describe, expect, it } from 'vitest';
import { positionKey } from '../position-key';
import type { RepertoireMove } from './graph';
import { RepertoireMoves } from './moves';

const START = positionKey(
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
);
const AFTER_E4 = positionKey(
  'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
);
const AFTER_D4 = positionKey(
  'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1',
);
const AFTER_E5 = positionKey(
  'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
);
const AFTER_C5 = positionKey(
  'rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
);

const e4 = { from: START, to: AFTER_E4, san: 'e4', uci: 'e2e4' };
const d4 = { from: START, to: AFTER_D4, san: 'd4', uci: 'd2d4' };
const e5 = { from: AFTER_E4, to: AFTER_E5, san: 'e5', uci: 'e7e5' };
const c5 = { from: AFTER_E4, to: AFTER_C5, san: 'c5', uci: 'c7c5' };

const stored = (
  move: typeof e4,
  chapters: readonly string[],
): RepertoireMove => ({ ...move, arrows: [], circles: [], chapters });

const secondAnswer = {
  ok: false,
  refusal: { reason: 'repertoire.secondAnswer' },
};

describe('RepertoireMoves', () => {
  it('adds a new move to a chapter, without marks', () => {
    const moves = new RepertoireMoves('white');
    expect(moves.put(e4, 'c1')).toEqual({
      ok: true,
      value: stored(e4, ['c1']),
    });
    expect(moves.list()).toEqual([stored(e4, ['c1'])]);
  });

  it('stores a move once per position: another chapter joins it', () => {
    const moves = new RepertoireMoves('white');
    moves.put(e4, 'c1');
    moves.put(e4, 'c2');
    moves.put(e4, 'c2');
    expect(moves.list()).toEqual([stored(e4, ['c1', 'c2'])]);
  });

  it('refuses a second player answer in a position (R-54), in any chapter', () => {
    const moves = new RepertoireMoves('white');
    moves.put(e4, 'c1');
    expect(moves.put(d4, 'c1')).toEqual(secondAnswer);
    expect(moves.put(d4, 'c2')).toEqual(secondAnswer);
    expect(moves.list()).toEqual([stored(e4, ['c1'])]);
  });

  it('allows several opponent moves in one position', () => {
    const moves = new RepertoireMoves('white');
    for (const move of [e4, e5, c5]) moves.put(move, 'c1');
    expect(moves.list().map((m) => m.san)).toEqual(['e4', 'e5', 'c5']);
  });

  it("knows the player's moves by the repertoire's side", () => {
    const black = new RepertoireMoves('black');
    for (const move of [e4, d4, e5]) black.put(move, 'c1');
    expect(black.put(c5, 'c1')).toEqual(secondAnswer);
    expect(black.list().map((m) => m.san)).toEqual(['e4', 'd4', 'e5']);
  });

  it('starts from existing moves without changing them', () => {
    const before = [stored(e4, ['c1']), stored(e5, ['c1'])];
    const moves = new RepertoireMoves('black', before);
    expect(moves.put(c5, 'c1')).toEqual(secondAnswer);
    moves.put(e4, 'c2');
    expect(before[0]?.chapters).toEqual(['c1']);
    expect(moves.list()).toEqual([stored(e4, ['c1', 'c2']), before[1]]);
  });

  it('keeps the marks of the moves it starts from, as copies', () => {
    const marked: RepertoireMove = {
      ...stored(e4, ['c1']),
      arrows: [{ from: 'g1', to: 'f3', color: 'G' }],
      circles: [{ square: 'd5', color: 'R' }],
    };
    const moves = new RepertoireMoves('white', [marked]);
    const put = moves.put(e4, 'c2');
    if (!put.ok) throw new Error(put.refusal.reason);
    expect(put.value).toEqual({ ...marked, chapters: ['c1', 'c2'] });
    put.value.arrows.push({ from: 'b1', to: 'c3', color: 'B' });
    put.value.circles.push({ square: 'e5', color: 'Y' });
    expect(marked.arrows).toHaveLength(1);
    expect(marked.circles).toHaveLength(1);
  });

  it('hands out copies: a later put does not change a list already taken', () => {
    const moves = new RepertoireMoves('white');
    moves.put(e4, 'c1');
    const taken = moves.list();
    const put = moves.put(e4, 'c2');
    if (!put.ok) throw new Error(put.refusal.reason);
    put.value.arrows.push({ from: 'g1', to: 'f3', color: 'G' });
    put.value.circles.push({ square: 'd5', color: 'R' });
    expect(taken).toEqual([stored(e4, ['c1'])]);
    expect(moves.list()[0]).toEqual({
      ...stored(e4, ['c1', 'c2']),
      arrows: [{ from: 'g1', to: 'f3', color: 'G' }],
      circles: [{ square: 'd5', color: 'R' }],
    });
  });

  it('returns the stored move, so its marks can be added to', () => {
    const moves = new RepertoireMoves('white');
    const put = moves.put(e4, 'c1');
    if (!put.ok) throw new Error(put.refusal.reason);
    put.value.arrows.push({ from: 'g1', to: 'f3', color: 'G' });
    expect(moves.list()[0]?.arrows).toEqual([
      { from: 'g1', to: 'f3', color: 'G' },
    ]);
  });
});
