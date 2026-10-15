import { describe, expect, it } from 'vitest';
import { checkLimits, PGN_LIMITS } from './limits';

const games = (n: number): string =>
  Array.from({ length: n }, () => '[Event "x"]\n\n1. e4 *').join('\n\n');

const nested = (depth: number): string =>
  `1. e4 ${'( 1. d4 '.repeat(depth)}${')'.repeat(depth)} *`;

/** Runs `check` and returns how long it took, in milliseconds. */
function timed(check: () => void): number {
  const start = performance.now();
  check();
  return performance.now() - start;
}

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

  it('reads 2 MB of unclosed comments in linear time, without over-counting', () => {
    const text = '{('.repeat(PGN_LIMITS.bytes / 2 - 1);
    let ok = false;
    const ms = timed(() => {
      ok = checkLimits(text).ok;
    });
    expect(ok).toBe(true);
    expect(ms).toBeLessThan(1000);
  });

  it('reads 2 MB of unclosed tag values and blank lines in linear time', () => {
    const quotes = '"\\'.repeat(PGN_LIMITS.bytes / 2 - 1);
    const blank = `${'\n'.repeat(PGN_LIMITS.bytes - 10)}[Event "x"]`;
    expect(timed(() => checkLimits(quotes))).toBeLessThan(1000);
    expect(timed(() => checkLimits(blank))).toBeLessThan(1000);
  });
});
