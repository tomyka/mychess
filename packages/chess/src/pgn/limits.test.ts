import { describe, expect, it } from 'vitest';
import { checkLimits, PGN_LIMITS } from './limits';
import { growth, LINEAR_GROWTH } from './test-support';

const games = (n: number): string =>
  Array.from({ length: n }, () => '[Event "x"]\n\n1. e4 *').join('\n\n');

const nested = (depth: number): string =>
  `1. e4 ${'( 1. d4 '.repeat(depth)}${')'.repeat(depth)} *`;

describe('checkLimits', () => {
  it('accepts a small file', () => {
    expect(checkLimits('1. e4 e5 *')).toEqual({ ok: true, value: undefined });
  });

  it('accepts a file of exactly 2 MB', () => {
    expect(checkLimits('a'.repeat(PGN_LIMITS.bytes)).ok).toBe(true);
  });

  it('refuses a file over 2 MB', () => {
    const text = 'a'.repeat(PGN_LIMITS.bytes + 1);
    expect(checkLimits(text)).toEqual({
      ok: false,
      refusal: { reason: 'pgn.tooLarge', limit: PGN_LIMITS.bytes },
    });
  });

  it('counts bytes, not characters (Lithuanian letters are two bytes)', () => {
    const text = 'ž'.repeat(PGN_LIMITS.bytes / 2 + 1);
    expect(checkLimits(text).ok).toBe(false);
  });

  it('accepts as many games as the limit', () => {
    expect(checkLimits(games(PGN_LIMITS.games)).ok).toBe(true);
  });

  it('refuses more games than the limit', () => {
    expect(checkLimits(games(PGN_LIMITS.games + 1))).toEqual({
      ok: false,
      refusal: { reason: 'pgn.tooManyGames', limit: PGN_LIMITS.games },
    });
  });

  it('accepts variations nested as deep as the limit', () => {
    expect(checkLimits(nested(PGN_LIMITS.depth)).ok).toBe(true);
  });

  it('refuses variations nested deeper than the limit', () => {
    expect(checkLimits(nested(PGN_LIMITS.depth + 1))).toEqual({
      ok: false,
      refusal: { reason: 'pgn.tooDeep', limit: PGN_LIMITS.depth },
    });
  });

  it('measures depth, not the number of variations', () => {
    const text = `1. e4 ${'( 1. d4 ) '.repeat(100)}*`;
    expect(checkLimits(text).ok).toBe(true);
  });

  it('ignores parentheses inside comments', () => {
    const text = `1. e4 {${'('.repeat(100)}} e5 *`;
    expect(checkLimits(text).ok).toBe(true);
  });

  it('ignores parentheses in rest-of-line comments and tag values', () => {
    const text = `[Event "${'('.repeat(100)}"]\n\n1. e4 ; ${'('.repeat(100)}\ne5 *`;
    expect(checkLimits(text).ok).toBe(true);
  });

  it('reads an escaped quote inside a tag value as part of the value', () => {
    const text = `[Event "a \\" ${'('.repeat(100)}"]\n\n1. e4 *`;
    expect(checkLimits(text).ok).toBe(true);
  });

  it('counts parentheses after a comment closes', () => {
    expect(checkLimits(`{x} ${nested(PGN_LIMITS.depth + 1)}`).ok).toBe(false);
    expect(checkLimits(`; x\n${nested(PGN_LIMITS.depth + 1)}`).ok).toBe(false);
  });

  it('treats an unclosed comment as running to the end of the text', () => {
    expect(checkLimits(`1. e4 { ${nested(PGN_LIMITS.depth + 1)}`).ok).toBe(
      true,
    );
  });

  it('reads unclosed comments in linear time, without over-counting', () => {
    const comments = (bytes: number) => '{('.repeat(bytes / 2 - 1);
    expect(checkLimits(comments(PGN_LIMITS.bytes)).ok).toBe(true);
    const ratio = growth(comments, checkLimits, PGN_LIMITS.bytes / 4);
    expect(ratio).toBeLessThan(LINEAR_GROWTH);
  }, 60_000);

  it('reads unclosed tag values and blank lines in linear time', () => {
    const quotes = (bytes: number) => '"\\'.repeat(bytes / 2 - 1);
    // Just under the size limit, so the whole text is read, not refused.
    const blank = (bytes: number) => `${'\n'.repeat(bytes - 20)}[Event "x"]`;
    for (const text of [quotes, blank]) {
      expect(text(PGN_LIMITS.bytes).length).toBeLessThan(PGN_LIMITS.bytes);
      expect(checkLimits(text(PGN_LIMITS.bytes)).ok).toBe(true);
      expect(growth(text, checkLimits, PGN_LIMITS.bytes / 4)).toBeLessThan(
        LINEAR_GROWTH,
      );
    }
  }, 60_000);
});
