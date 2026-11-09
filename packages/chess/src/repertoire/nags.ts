/**
 * Numeric Annotation Glyphs (R-175): a move keeps its PGN NAGs (`$1` to
 * `$255`) and shows the standard glyph of the common ones. A glyph is
 * notation, like SAN, so it does not go through the message catalogues
 * (spec decision 2).
 */

/** The highest NAG the PGN standard defines. */
export const NAG_MAX = 255;

/** Move assessments, written right after the SAN. */
const MOVE_GLYPHS: Readonly<Record<number, string>> = {
  1: '!',
  2: '?',
  3: '!!',
  4: '??',
  5: '!?',
  6: '?!',
};

/** Position assessments, written after the SAN and a space. */
const POSITION_GLYPHS: Readonly<Record<number, string>> = {
  10: '=',
  13: '∞',
  14: '⩲',
  15: '⩱',
  16: '±',
  17: '∓',
  18: '+-',
  19: '-+',
};

/** Whether `nag` is a NAG the PGN standard can hold: a whole number from 1 to 255. */
export const isNag = (nag: number): boolean =>
  Number.isInteger(nag) && nag >= 1 && nag <= NAG_MAX;

const glyphsOf = (
  nags: readonly number[],
  table: Readonly<Record<number, string>>,
): string => nags.map((nag) => table[nag] ?? '').join('');

/**
 * `san` with the glyphs of its shown NAGs: "Qxc4!", "Ba8 ⩲", "e4! ⩲". A NAG
 * without a glyph adds nothing.
 */
export function annotatedSan(san: string, nags: readonly number[]): string {
  const position = glyphsOf(nags, POSITION_GLYPHS);
  return `${san}${glyphsOf(nags, MOVE_GLYPHS)}${position === '' ? '' : ` ${position}`}`;
}
