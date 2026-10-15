import { describe, expect, it } from 'vitest';
import { checkLimits, PGN_LIMITS } from './limits';

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

  it('accepts 200 games', () => {
    const text = Array.from(
      { length: 200 },
      () => '[Event "x"]\n\n1. e4 *',
    ).join('\n\n');
    expect(checkLimits(text).ok).toBe(true);
  });

  it('refuses more than 200 games', () => {
    const text = Array.from(
      { length: 201 },
      () => '[Event "x"]\n\n1. e4 *',
    ).join('\n\n');
    expect(checkLimits(text)).toEqual({
      ok: false,
      refusal: { reason: 'pgn.tooManyGames', limit: 200 },
    });
  });

  it('accepts variations nested 64 deep', () => {
    const text = `1. e4 ${'( 1. d4 '.repeat(64)}${')'.repeat(64)} *`;
    expect(checkLimits(text).ok).toBe(true);
  });

  it('refuses variations nested deeper than 64', () => {
    const text = `1. e4 ${'( 1. d4 '.repeat(65)}${')'.repeat(65)} *`;
    expect(checkLimits(text)).toEqual({
      ok: false,
      refusal: { reason: 'pgn.tooDeep', limit: 64 },
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
});
