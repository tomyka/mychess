import { describe, expect, it } from 'vitest';
import {
  lineText,
  lineTextsFromTrunk,
  moveNumber,
  numberedMove,
} from './notation';

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

describe('numberedMove', () => {
  it('writes a White move with one dot and a space', () => {
    expect(numberedMove(2, 'white', 'Bf4')).toBe('2. Bf4');
  });

  it('writes a Black move with an ellipsis and no space', () => {
    expect(numberedMove(5, 'black', 'a6')).toBe('5...a6');
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

  it('writes from a later move after "…", numbered from the root', () => {
    expect(lineText(['e4', 'c6', 'd4', 'd5', 'e5'], true, 2)).toBe(
      '… 2. d4 d5 3. e5',
    );
    expect(lineText(['e4', 'c6', 'd4', 'd5'], true, 3)).toBe('… 2... d5');
  });
});

describe('lineTextsFromTrunk', () => {
  it('writes each line from where it leaves the chapter trunk', () => {
    const lines = [
      ['d4', 'd5', 'c4', 'c6', 'Nf3', 'Nf6', 'Nc3', 'dxc4', 'a4', 'Bf5'],
      ['d4', 'd5', 'c4', 'c6', 'Nf3', 'Nf6', 'Nc3', 'dxc4', 'e4', 'b5'],
    ];
    expect(lineTextsFromTrunk(lines, true)).toEqual([
      '… 5. a4 Bf5',
      '… 5. e4 b5',
    ]);
  });

  it('numbers a Black move after the trunk with an ellipsis', () => {
    const lines = [
      ['e4', 'c5', 'Nf3', 'e6'],
      ['e4', 'c5', 'Nf3', 'd6'],
    ];
    expect(lineTextsFromTrunk(lines, true)).toEqual(['… 2... e6', '… 2... d6']);
  });

  it('writes a one-line chapter in full', () => {
    expect(lineTextsFromTrunk([['e4', 'e5']], true)).toEqual(['1. e4 e5']);
  });

  it('numbers a Black-first chapter from 1...', () => {
    // 1... e5 2. Nf3 is the trunk; the lines part at Black's second move.
    const lines = [
      ['e5', 'Nf3', 'Nc6'],
      ['e5', 'Nf3', 'd6'],
    ];
    expect(lineTextsFromTrunk(lines, false)).toEqual([
      '… 2... Nc6',
      '… 2... d6',
    ]);
  });

  it('writes a line that ends inside the trunk from its last move', () => {
    const lines = [
      ['e4', 'e5'],
      ['e4', 'e5', 'Nf3'],
    ];
    expect(lineTextsFromTrunk(lines, true)).toEqual([
      '… 1... e5',
      '… 1... e5 2. Nf3',
    ]);
  });

  it('writes nothing for no lines', () => {
    expect(lineTextsFromTrunk([], true)).toEqual([]);
  });
});
