import { describe, expect, it } from 'vitest';
import { lineText, moveNumber } from './notation';

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

describe('lineText', () => {
  it('numbers the first move and every White move from a White root', () => {
    expect(lineText(['e4', 'c6', 'd4', 'd5', 'e5'], true)).toBe(
      '1. e4 c6 2. d4 d5 3. e5',
    );
  });

  it('numbers a Black first move with an ellipsis', () => {
    expect(lineText(['c6', 'd4', 'd5'], false)).toBe('1... c6 2. d4 d5');
  });

  it('is empty for no moves', () => {
    expect(lineText([], true)).toBe('');
  });
});
