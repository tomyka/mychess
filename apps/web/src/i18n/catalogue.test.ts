import { describe, expect, it } from 'vitest';
import { LOCALE, MESSAGES } from './catalogue';

describe('the message catalogue', () => {
  it('is English (#378)', () => {
    expect(LOCALE).toBe('en');
    expect(MESSAGES.app.title).toBe('MyChess');
  });

  it('writes the brand as MyChess in every text (R-170)', () => {
    const texts = JSON.stringify(MESSAGES);
    // A host (mychess.lt, @mychess.test) is a domain, not the brand.
    const brands = [...texts.matchAll(/mychess(?!\.(?:lt|test)\b)/giu)];
    expect(brands.map(([found]) => found)).toEqual(brands.map(() => 'MyChess'));
    expect(brands.length).toBeGreaterThan(0);
  });

  it('has an ASCII-safe PGN file name fallback', () => {
    expect(MESSAGES.pgn.fileNameFallback).toMatch(/^[a-z0-9-]+$/);
  });
});
