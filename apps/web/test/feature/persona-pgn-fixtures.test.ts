/**
 * The persona PGN files that G-M1-2 and D-M1-2 import (docs/personas,
 * e2e/fixtures/persona-*.pgn) are legal for their side and import whole:
 * every game becomes a chapter, nothing is skipped, comments survive, and
 * the files stay inside the upload limits (R-66, R-119).
 */
import { readFileSync } from 'node:fs';
import {
  checkLimits,
  importPgn,
  PGN_LIMITS,
  type ImportedRepertoire,
  type Side,
} from '@mychess/chess';
import { describe, expect, it } from 'vitest';

const fixture = (name: string): string =>
  readFileSync(new URL(`../../e2e/fixtures/${name}`, import.meta.url), 'utf8');

/** The deepest parenthesis nesting of `text`, comments left out. */
function variationDepth(text: string): number {
  let depth = 0;
  let deepest = 0;
  for (const char of text.replace(/\{[^}]*\}/g, '')) {
    if (char === '(') deepest = Math.max(deepest, ++depth);
    if (char === ')') depth--;
  }
  return deepest;
}

function imported(text: string, side: Side): ImportedRepertoire {
  const result = importPgn(text, side);
  if (!result.ok) throw new Error(result.refusal.reason);
  return result.value;
}

const commentsOf = ({ graph }: ImportedRepertoire): string[] =>
  graph.moves.flatMap((m) => (m.comment === null ? [] : [m.comment]));

const introsOf = ({ graph }: ImportedRepertoire): string[] =>
  graph.chapters.flatMap((c) => (c.intro === null ? [] : [c.intro]));

describe.each([
  {
    file: 'persona-taimanov.pgn',
    side: 'black' as const,
    games: 6,
    comments: 9,
    intros: 2,
  },
  {
    file: 'persona-katalonu.pgn',
    side: 'white' as const,
    games: 5,
    comments: 7,
    intros: 2,
  },
])('$file', ({ file, side, games, comments, intros }) => {
  const text = fixture(file);

  it('stays well inside the upload limits', () => {
    expect(checkLimits(text)).toEqual({ ok: true, value: undefined });
    expect(new TextEncoder().encode(text).length).toBeLessThan(
      PGN_LIMITS.bytes / 100,
    );
    expect(variationDepth(text)).toBeLessThan(PGN_LIMITS.depth);
  });

  it('imports every game as a chapter, skipping nothing', () => {
    const result = imported(text, side);
    expect(result.skipped).toEqual([]);
    expect(result.graph.chapters).toHaveLength(games);
    expect(games).toBeLessThanOrEqual(PGN_LIMITS.games);
  });

  it('keeps every move comment and chapter intro', () => {
    const result = imported(text, side);
    expect(commentsOf(result)).toHaveLength(comments);
    expect(introsOf(result)).toHaveLength(intros);
  });
});

describe('persona-taimanov.pgn shape (G-M1-2)', () => {
  const text = fixture('persona-taimanov.pgn');

  it('has nested variations', () => {
    expect(variationDepth(text)).toBe(2);
  });

  it('merges the 3.Nc3 move order into the English Attack: one 6...a6 for both', () => {
    const { graph } = imported(text, 'black');
    const [english, , , nc3] = graph.chapters;
    const a6 = graph.moves.filter(
      (m) => m.san === 'a6' && m.chapters.includes(english?.id ?? ''),
    );
    expect(a6).toHaveLength(1);
    expect(a6[0]?.chapters).toContain(nc3?.id);
  });

  it("keeps Gabija's note on 8...Bb4", () => {
    const { graph } = imported(text, 'black');
    const bb4 = graph.moves.find((m) => m.comment === 'jei 9.Na4, tai Be7');
    expect(bb4?.san).toBe('Bb4');
  });
});

describe('persona-katalonu.pgn shape (D-M1-2)', () => {
  const text = fixture('persona-katalonu.pgn');

  it('carries the NAGs $1 and $14, and the sidelines as variations', () => {
    expect(text).toContain('$1 ');
    expect(text).toContain('$14');
    expect(variationDepth(text)).toBe(1);
  });
});
