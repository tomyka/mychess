import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { playerSide } from './player-side';

const game = (white: string, black: string, moves = '1. e4 c5 *') =>
  `[White "${white}"]\n[Black "${black}"]\n\n${moves}\n`;

describe('playerSide (decision 8)', () => {
  it('gives the colour every game names the player in', () => {
    const text =
      game('Someone', 'Dovydas Jankauskas') +
      game('Other', 'Dovydas Jankauskas');
    expect(playerSide(text, ['Dovydas Jankauskas'])).toBe('black');
    expect(
      playerSide(game('Dovydas Jankauskas', 'X'), ['Dovydas Jankauskas']),
    ).toBe('white');
  });
  it('matches any of the names, without case or surrounding spaces', () => {
    expect(playerSide(game('X', ' DovydasJ '), ['Dovydas', 'dovydasj'])).toBe(
      'black',
    );
    expect(playerSide(game('Dovydas', 'X'), [' DOVYDAS '])).toBe('white');
  });
  it('matches a Lithuanian name however its letters are composed', () => {
    const composed = 'Rūta Navickaitė'.normalize('NFC');
    const decomposed = 'Rūta Navickaitė'.normalize('NFD');
    expect(decomposed).not.toBe(composed);
    expect(playerSide(game('X', decomposed), [composed])).toBe('black');
    expect(playerSide(game(composed, 'X'), [decomposed])).toBe('white');
    expect(playerSide(game('X', 'RŪTA NAVICKAITĖ'), [decomposed])).toBe(
      'black',
    );
  });
  it('accepts the games naming the player by different names', () => {
    const text = game('Rokas P', 'X') + game('rokasp', 'Y');
    expect(playerSide(text, ['Rokas P', 'RokasP'])).toBe('white');
  });
  it('gives null when the games disagree, a game names neither side, or both', () => {
    const name = ['Rokas'];
    expect(
      playerSide(game('Rokas', 'X') + game('X', 'Rokas'), name),
    ).toBeNull();
    expect(playerSide(game('Rokas', 'X') + game('A', 'B'), name)).toBeNull();
    expect(playerSide(game('Rokas', 'Rokas'), name)).toBeNull();
    expect(playerSide('1. e4 c5 *', name)).toBeNull();
  });
  it('gives null with no names, no games, or text it cannot read', () => {
    expect(playerSide(game('Rokas', 'X'), [])).toBeNull();
    expect(playerSide(game('Rokas', 'X'), ['  '])).toBeNull();
    expect(playerSide('', ['Rokas'])).toBeNull();
    expect(playerSide('[White "Rokas"', ['Rokas'])).toBeNull();
  });
  it('flips with the colours: swapping White and Black swaps the side', () => {
    const name = fc.stringMatching(/^[A-Za-z][A-Za-z ]{0,10}[A-Za-z]$/);
    fc.assert(
      fc.property(
        fc.array(fc.tuple(name, name), { minLength: 1, maxLength: 4 }),
        name,
        (pairs, player) => {
          const as = (swap: boolean) =>
            pairs.map(([w, b]) => (swap ? game(b, w) : game(w, b))).join('\n');
          const side = playerSide(as(false), [player]);
          const flipped = playerSide(as(true), [player]);
          const other = { white: 'black', black: 'white' } as const;
          expect(flipped).toBe(side === null ? null : other[side]);
        },
      ),
    );
  });
});
