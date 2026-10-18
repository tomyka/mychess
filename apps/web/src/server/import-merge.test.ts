import { importPgn, mergeInto, type RepertoireGraph } from '@mychess/chess';
import { describe, expect, it } from 'vitest';
import { graphOf, LONDON } from '../../test/fixtures/repertoires';
import { mergeAddition } from './import-merge';

const game = (movetext: string): string => `[Event "?"]\n\n${movetext}\n`;

/** `existing` with `text` merged into it. */
function merged(existing: RepertoireGraph, text: string): RepertoireGraph {
  const imported = importPgn(text, existing.side);
  if (!imported.ok) throw new Error(imported.refusal.reason);
  const result = mergeInto(existing, imported.value);
  if (!result.ok) throw new Error(result.refusal.reason);
  return result.value.graph;
}

const BEFORE = graphOf(LONDON);

describe('mergeAddition', () => {
  it('counts what the merge adds and names its first new chapter', () => {
    const after = merged(
      BEFORE,
      game('1. d4 d5 2. Bf4 c5 3. e3 *') + game('1. d4 e6 2. Bf4 *'),
    );
    expect(mergeAddition(BEFORE, after)).toEqual({
      ok: true,
      value: {
        chapters: 2,
        moves: after.moves.length - BEFORE.moves.length,
        firstChapterId: 'c3',
      },
    });
    expect(after.moves.length - BEFORE.moves.length).toBeGreaterThan(0);
  });

  it('adds a chapter even when every move of it is already there', () => {
    const after = merged(BEFORE, game('1. d4 d5 2. Bf4 *'));
    expect(mergeAddition(BEFORE, after)).toEqual({
      ok: true,
      value: { chapters: 1, moves: 0, firstChapterId: 'c3' },
    });
  });

  it('refuses when every game of the file is refused against the repertoire (R-115)', () => {
    const after = merged(BEFORE, game('1. e4 e5 *') + game('1. c4 e5 *'));
    expect(after).toEqual(BEFORE);
    expect(mergeAddition(BEFORE, after)).toEqual({
      ok: false,
      refusal: { reason: 'pgn.nothingToAdd' },
    });
  });
});
