import { describe, expect, it } from 'vitest';
import type { Side } from '../repertoire/graph';
import { importPgn } from './import-pgn';
import { suggestedSide } from './side-check';

const pgn = (...movetexts: string[]): string =>
  movetexts.map((moves) => `[Event "?"]\n\n${moves} *\n`).join('\n');

/** What suggestedSide says of `text` imported for `side`. */
function suggested(text: string, side: Side): Side | null {
  const imported = importPgn(text, side);
  if (!imported.ok) throw new Error('the test file must import');
  return suggestedSide(text, side, imported.value);
}

/** Black's one answer to each of White's first moves: a Black repertoire. */
const BLACK_FILE = pgn('1. e4 c5', '1. d4 Nf6', '1. c4 e5', '1. Nf3 d5');

/** White's one move against each of Black's answers: a White repertoire. */
const WHITE_FILE = pgn('1. e4 c5 2. Nf3', '1. e4 e5 2. Nf3', '1. e4 e6 2. d4');

describe('suggestedSide (#364, R-214)', () => {
  it('suggests Black for a Black repertoire imported as White', () => {
    // As White, games 2-4 each lose a second first move.
    expect(suggested(BLACK_FILE, 'white')).toBe('black');
  });

  it('suggests White for a White repertoire imported as Black', () => {
    expect(suggested(WHITE_FILE, 'black')).toBe('white');
  });

  it('suggests nothing when the side fits', () => {
    expect(suggested(BLACK_FILE, 'black')).toBeNull();
    expect(suggested(WHITE_FILE, 'white')).toBeNull();
  });

  it('suggests nothing when only half the games lose a second answer', () => {
    // As White: game 2 of 2 loses 1. d4; one game is not most of two.
    expect(suggested(pgn('1. e4 c5', '1. d4 d5'), 'white')).toBeNull();
  });

  it('counts a game once however many second answers it loses', () => {
    // As White only game 2 loses moves (three first moves): 1 game of 4.
    const text = pgn(
      '1. e4 c5',
      '1. d4 (1. c4 e5) (1. Nf3 d5) Nf6',
      '1. e4 c5 2. Nf3',
      '1. e4 c5 2. Nf3 d6',
    );
    const asWhite = importPgn(text, 'white');
    expect(asWhite.ok && asWhite.value.skipped).toHaveLength(3);
    expect(suggested(text, 'white')).toBeNull();
  });

  it('suggests nothing when the other side would lose as many games', () => {
    // As White, games 2, 3 and 5 lose 1. d4; as Black, games 3, 4 and 5
    // lose a second answer. Switching would not help, so neither side warns.
    const text = pgn(
      '1. e4 e5',
      '1. d4 d5',
      '1. d4 Nf6',
      '1. e4 c5',
      '1. d4 e6',
    );
    expect(suggested(text, 'white')).toBeNull();
    expect(suggested(text, 'black')).toBeNull();
  });
});
