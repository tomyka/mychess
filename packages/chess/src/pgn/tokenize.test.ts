import { describe, expect, it } from 'vitest';
import { tokenize } from './tokenize';

function tokensOf(text: string) {
  const result = tokenize(text);
  if (!result.ok)
    throw new Error(`expected tokens, got ${result.refusal.reason}`);
  return result.value;
}

describe('tokenize', () => {
  it('reads tag pairs, unescaping quotes and backslashes', () => {
    expect(tokensOf('[Event "Say \\"hi\\" C:\\\\"]')).toEqual([
      { kind: 'tag', name: 'Event', value: 'Say "hi" C:\\' },
    ]);
  });

  it('reads tag pairs with extra spaces inside the brackets', () => {
    expect(tokensOf('[ Event   "Rapid"  ]')).toEqual([
      { kind: 'tag', name: 'Event', value: 'Rapid' },
    ]);
  });

  it('drops multi-digit move numbers', () => {
    expect(tokensOf('12. e4 12... e5')).toEqual([
      { kind: 'san', san: 'e4' },
      { kind: 'san', san: 'e5' },
    ]);
  });

  it('drops move numbers, glued or not, with one or three dots', () => {
    expect(tokensOf('1. e4 1...e5 2.Nf3')).toEqual([
      { kind: 'san', san: 'e4' },
      { kind: 'san', san: 'e5' },
      { kind: 'san', san: 'Nf3' },
    ]);
  });

  it('reads variations, NAGs and game results', () => {
    expect(tokensOf('e4 $1 (d4 $19) 1/2-1/2 1-0 0-1 *')).toEqual([
      { kind: 'san', san: 'e4' },
      { kind: 'nag', nag: 1 },
      { kind: 'open' },
      { kind: 'san', san: 'd4' },
      { kind: 'nag', nag: 19 },
      { kind: 'close' },
      { kind: 'result' },
      { kind: 'result' },
      { kind: 'result' },
      { kind: 'result' },
    ]);
  });

  it.each([
    ['!', 1],
    ['?', 2],
    ['!!', 3],
    ['??', 4],
    ['!?', 5],
    ['?!', 6],
  ])('turns the suffix %s into NAG %i', (glyph, nag) => {
    expect(tokensOf(`e4${glyph}`)).toEqual([
      { kind: 'san', san: 'e4' },
      { kind: 'nag', nag },
    ]);
  });

  it('reads a glyph written apart from its move as a NAG', () => {
    expect(tokensOf('e4 !? ??!')).toEqual([
      { kind: 'san', san: 'e4' },
      { kind: 'nag', nag: 5 },
    ]);
  });

  it('drops a glyph run that stands for no NAG', () => {
    expect(tokensOf('e4!!?')).toEqual([{ kind: 'san', san: 'e4' }]);
  });

  it('reads brace comments across lines, trimmed and with whitespace collapsed', () => {
    expect(tokensOf('e4 {  best\n  by   test }')).toEqual([
      { kind: 'san', san: 'e4' },
      { kind: 'pgnComment', text: 'best by test' },
    ]);
  });

  it('removes embedded commands such as arrows and clocks from comments', () => {
    expect(
      tokensOf('e4 { [%cal Ge2e4,Rd2d4] main idea [%csl Gd5][%clk 0:05:00] }'),
    ).toEqual([
      { kind: 'san', san: 'e4' },
      { kind: 'pgnComment', text: 'main idea' },
    ]);
  });

  it('keeps words apart when a command between them is removed', () => {
    expect(tokensOf('e4 {before[%clk 0:05:00]after}')).toEqual([
      { kind: 'san', san: 'e4' },
      { kind: 'pgnComment', text: 'before after' },
    ]);
  });

  it('drops comments that are empty once commands are removed', () => {
    expect(tokensOf('e4 { [%clk 0:05:00] } {}')).toEqual([
      { kind: 'san', san: 'e4' },
    ]);
  });

  it('drops rest-of-line comments', () => {
    expect(tokensOf('e4 ; a note\r\ne5')).toEqual([
      { kind: 'san', san: 'e4' },
      { kind: 'san', san: 'e5' },
    ]);
  });

  it('refuses an unterminated comment, saying where it starts', () => {
    expect(tokenize('e4 { never closed')).toEqual({
      ok: false,
      refusal: { reason: 'pgn.unreadable', offset: 3 },
    });
  });

  it('refuses a malformed tag pair, saying where it starts', () => {
    expect(tokenize('[Event Rapid]\n1. e4')).toEqual({
      ok: false,
      refusal: { reason: 'pgn.unreadable', offset: 0 },
    });
  });

  it('reads nothing from blank text', () => {
    expect(tokensOf(' \r\n\t')).toEqual([]);
  });
});
