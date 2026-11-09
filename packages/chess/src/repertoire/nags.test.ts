import { describe, expect, it } from 'vitest';
import { annotatedSan, isNag } from './nags';

describe('annotatedSan: the glyphs shown (R-175, decision 2)', () => {
  it.each([
    [1, 'e4!'],
    [2, 'e4?'],
    [3, 'e4!!'],
    [4, 'e4??'],
    [5, 'e4!?'],
    [6, 'e4?!'],
    [10, 'e4 ='],
    [13, 'e4 ∞'],
    [14, 'e4 ⩲'],
    [15, 'e4 ⩱'],
    [16, 'e4 ±'],
    [17, 'e4 ∓'],
    [18, 'e4 +-'],
    [19, 'e4 -+'],
  ])('shows NAG %i as %s', (nag, shown) => {
    expect(annotatedSan('e4', [nag])).toBe(shown);
  });

  it.each([0, 7, 9, 11, 12, 20, 36, 255])(
    'shows no glyph for NAG %i',
    (nag) => {
      expect(annotatedSan('e4', [nag])).toBe('e4');
    },
  );
});

describe('isNag', () => {
  it.each([1, 2, 146, 255])('takes %i', (nag) => {
    expect(isNag(nag)).toBe(true);
  });

  it.each([0, 256, -1, 1.5])('refuses %d', (nag) => {
    expect(isNag(nag)).toBe(false);
  });
});

describe('annotatedSan', () => {
  it('writes the SAN alone when it has no shown NAG', () => {
    expect(annotatedSan('e4', [])).toBe('e4');
    expect(annotatedSan('e4', [36, 146])).toBe('e4');
  });

  it('writes a move assessment right after the SAN', () => {
    expect(annotatedSan('Qxc4', [1])).toBe('Qxc4!');
    expect(annotatedSan('Qxc4', [5])).toBe('Qxc4!?');
  });

  it('writes a position assessment after a space', () => {
    expect(annotatedSan('Ba8', [14])).toBe('Ba8 ⩲');
  });

  it('writes the move assessment first, then the position, skipping the rest', () => {
    expect(annotatedSan('e4', [14, 36, 1])).toBe('e4! ⩲');
  });
});
