import { lineText } from '@mychess/chess';
import { describe, expect, it } from 'vitest';
import { PHONE_MOVES, phoneLine } from './phone-line';

const SANS = 'e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng3 Bg6 h4 h6 Nf3 Nd7'.split(' ');

describe('phoneLine', () => {
  it('writes a short line whole', () => {
    expect(phoneLine(SANS.slice(0, 4), true)).toBe('1. e4 c6 2. d4 d5');
  });

  it('writes a line of exactly six full moves whole, as lineText does', () => {
    const six = SANS.slice(0, 2 * PHONE_MOVES);
    expect(phoneLine(six, true)).toBe(lineText(six, true));
  });

  it('keeps the last six full moves, from a move number, after an ellipsis', () => {
    expect(phoneLine(SANS, true)).toBe(
      '… 2. d4 d5 3. Nc3 dxe4 4. Nxe4 Bf5 5. Ng3 Bg6 6. h4 h6 7. Nf3 Nd7',
    );
  });

  it('cuts before a White move when the line ends on one', () => {
    expect(phoneLine(SANS.slice(0, 13), true)).toBe(
      '… 2. d4 d5 3. Nc3 dxe4 4. Nxe4 Bf5 5. Ng3 Bg6 6. h4 h6 7. Nf3',
    );
  });

  it('starts a Black-first line with its number and dots', () => {
    expect(phoneLine(['c6', 'd4'], false)).toBe('1... c6 2. d4');
  });

  it('cuts a long Black-first line at a White move number too', () => {
    expect(phoneLine(SANS.slice(1), false)).toBe(
      '… 2. d4 d5 3. Nc3 dxe4 4. Nxe4 Bf5 5. Ng3 Bg6 6. h4 h6 7. Nf3 Nd7',
    );
  });

  it('keeps as many full moves as asked', () => {
    expect(phoneLine(SANS, true, 2)).toBe('… 6. h4 h6 7. Nf3 Nd7');
  });

  it('is empty for no moves', () => {
    expect(phoneLine([], true)).toBe('');
    expect(phoneLine([], false)).toBe('');
  });
});
