import { describe, it, expect } from 'vitest';
import {
  planMultiImport,
  chapterName,
  planGameImport,
  resolvePlayerColor,
  capVariationDepth,
  type MoveRow
} from './pgn-import';

function move(fromFen: string, toFen: string, san: string, isPlayerTurn: boolean): MoveRow {
  return { fromFen, toFen, san, move_number: 0, is_player_turn: isPlayerTurn, annotation: null };
}

describe('planMultiImport', () => {
  it('returns an error for a PGN with no valid games', () => {
    const result = planMultiImport('not a real pgn', 'white');
    expect(result).toEqual({ error: 'No valid games found in PGN' });
  });

  it('returns one chapter for a single-game PGN', () => {
    const result = planMultiImport('1. e4 e5 *', 'white');
    if ('error' in result) throw new Error('expected chapters, got error: ' + result.error);
    expect(result).toHaveLength(1);
  });

  it('marks white moves as is_player_turn for a white repertoire', () => {
    const result = planMultiImport('1. e4 e5 *', 'white');
    if ('error' in result) throw new Error('expected chapters, got error: ' + result.error);
    expect(result[0].moves).toHaveLength(2);
    expect(result[0].moves[0]).toMatchObject({ san: 'e4', move_number: 1, is_player_turn: true });
    expect(result[0].moves[1]).toMatchObject({ san: 'e5', move_number: 2, is_player_turn: false });
  });

  it('marks black moves as is_player_turn for a black repertoire', () => {
    const result = planMultiImport('1. e4 e5 *', 'black');
    if ('error' in result) throw new Error('expected chapters, got error: ' + result.error);
    expect(result[0].moves[0]).toMatchObject({ san: 'e4', is_player_turn: false });
    expect(result[0].moves[1]).toMatchObject({ san: 'e5', is_player_turn: true });
  });

  it('carries the from/to FEN pair for each move', () => {
    const result = planMultiImport('1. e4 e5 *', 'white');
    if ('error' in result) throw new Error('expected chapters, got error: ' + result.error);
    const moves = result[0].moves;
    expect(moves[0].fromFen).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    expect(moves[0].toFen).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1');
    expect(moves[1].fromFen).toBe(moves[0].toFen);
  });

  it('returns an error for a PGN with headers but no actual moves', () => {
    const result = planMultiImport('[Event "test"]\n\n*', 'white');
    expect(result).toEqual({ error: 'No valid games found in PGN' });
  });

  it('keeps each game as its own chapter rather than merging them into one tree', () => {
    const twoGames = '[Event "A"]\n\n1. e4 e5 *\n\n[Event "B"]\n\n1. e4 e5 2. Nf3 *';
    const result = planMultiImport(twoGames, 'white');
    if ('error' in result) throw new Error('expected chapters, got error: ' + result.error);
    expect(result).toHaveLength(2);
    expect(result[0].moves).toHaveLength(2); // e4 e5
    expect(result[1].moves).toHaveLength(3); // e4 e5 Nf3
  });

  it('names each chapter from its own headers', () => {
    const twoGames = '[Event "Line A"]\n\n1. e4 e5 *\n\n[Event "Line B"]\n\n1. d4 d5 *';
    const result = planMultiImport(twoGames, 'white');
    if ('error' in result) throw new Error('expected chapters, got error: ' + result.error);
    expect(result[0].name).toBe('Line A');
    expect(result[1].name).toBe('Line B');
  });

  it('detects opening per chapter independently', () => {
    const twoGames = '[Event "A"]\n\n1. e4 e5 *\n\n[Event "B"]\n\n1. a3 a5 *';
    const result = planMultiImport(twoGames, 'white');
    if ('error' in result) throw new Error('expected chapters, got error: ' + result.error);
    expect(result[0].ecoCode).toBe('C20');
    expect(result[1].ecoCode).toBeNull();
  });

  // A knight shuffle (out and back) is legal indefinitely — good for a
  // synthetic PGN longer than any real cap under test.
  function knightShufflePgn(fullMoves: number): string {
    return Array.from({ length: fullMoves }, (_, i) => {
      const out = i % 2 === 0;
      return `${i + 1}. ${out ? 'Nf3 Nf6' : 'Ng1 Ng8'}`;
    }).join(' ');
  }

  it('caps each chapter to 20 player moves by default', () => {
    const result = planMultiImport(`${knightShufflePgn(25)} *`, 'white');
    if ('error' in result) throw new Error('expected chapters, got error: ' + result.error);
    const playerMoves = result[0].moves.filter((m) => m.is_player_turn);
    expect(playerMoves).toHaveLength(20);
  });

  it('honors a custom max-variation-moves cap', () => {
    const result = planMultiImport(`${knightShufflePgn(25)} *`, 'white', 5);
    if ('error' in result) throw new Error('expected chapters, got error: ' + result.error);
    const playerMoves = result[0].moves.filter((m) => m.is_player_turn);
    expect(playerMoves).toHaveLength(5);
  });
});

describe('capVariationDepth', () => {
  it('leaves a variation under the cap untouched', () => {
    const moves = [move('a', 'b', 'e4', true), move('b', 'c', 'e5', false)];
    expect(capVariationDepth(moves, 5)).toEqual(moves);
  });

  it('drops moves past the cap on a single linear line', () => {
    const moves = [
      move('a', 'b', 'e4', true),
      move('b', 'c', 'e5', false),
      move('c', 'd', 'Nf3', true),
      move('d', 'e', 'Nc6', false)
    ];
    const result = capVariationDepth(moves, 1);
    expect(result.map((m) => m.san)).toEqual(['e4', 'e5']);
  });

  it('keeps a sibling branch that diverges before the cap, even though another branch is deep', () => {
    // From position P: one branch (e5) stops immediately (short), the other
    // (c5) continues on for several more of the player's own moves.
    const moves = [
      move('start', 'p', 'e4', true),
      move('p', 'short-end', 'e5', false),
      move('p', 'q', 'c5', false),
      move('q', 'r', 'Nf3', true),
      move('r', 's', 'd6', false),
      move('s', 't', 'd4', true)
    ];
    const result = capVariationDepth(moves, 1);
    const sans = result.map((m) => m.san);
    expect(sans).toContain('e5'); // short branch survives — it never exceeded the cap
    expect(sans).toContain('c5'); // divergence point itself is still move 1, kept
    expect(sans).not.toContain('Nf3'); // this is the player's 2nd move — past the cap
    expect(sans).not.toContain('d4');
  });

  it('only counts the studied color\'s own moves toward the cap', () => {
    const moves = [
      move('a', 'b', 'e4', true),
      move('b', 'c', 'e5', false),
      move('c', 'd', 'Nf3', true),
      move('d', 'e', 'Nc6', false),
      move('e', 'f', 'Bb5', true)
    ];
    const result = capVariationDepth(moves, 2);
    // 2 player moves allowed (e4, Nf3) — their replies (e5, Nc6) stay too,
    // but the 3rd player move (Bb5) is dropped.
    expect(result.map((m) => m.san)).toEqual(['e4', 'e5', 'Nf3', 'Nc6']);
  });
});

describe('chapterName', () => {
  it('uses the Event header when present and meaningful', () => {
    expect(chapterName({ Event: 'Spanish Four Knights 4 Bb5 Bd6' }, 0)).toBe('Spanish Four Knights 4 Bb5 Bd6');
  });

  it('falls back to White when Event is missing', () => {
    expect(chapterName({ White: 'Spanish Four Knights 4 Bb5 Bd6', Black: 'Reference File' }, 0)).toBe(
      'Spanish Four Knights 4 Bb5 Bd6'
    );
  });

  it('falls back to White when Event is the PGN placeholder "?"', () => {
    expect(chapterName({ Event: '?', White: 'Chapter Two' }, 1)).toBe('Chapter Two');
  });

  it('falls back to a plain ordinal when neither Event nor White is usable', () => {
    expect(chapterName({ Event: '?', White: '?' }, 2)).toBe('Game 3');
  });

  // A real tournament-games PGN has actual player names in White, which
  // counts as "usable" text — this feature is scoped to the manual PGN
  // upload flow (opening theory/reference files), not the auto "my games"
  // import, so a player's name ending up as a chapter label here is an
  // accepted edge case rather than something worth special-casing.
  it('uses White as-is even when it looks like a player name, not a chapter title', () => {
    expect(chapterName({ Event: '?', White: 'Carlsen, M', Black: 'Nakamura, H' }, 2)).toBe('Carlsen, M');
  });
});

describe('resolvePlayerColor', () => {
  it('matches the White header case-insensitively', () => {
    expect(resolvePlayerColor({ White: 'MagnusCarlsen', Black: 'someoneElse' }, 'magnuscarlsen')).toBe('white');
  });

  it('matches the Black header case-insensitively', () => {
    expect(resolvePlayerColor({ White: 'someoneElse', Black: 'MagnusCarlsen' }, 'magnuscarlsen')).toBe('black');
  });

  it('returns null when neither side matches', () => {
    expect(resolvePlayerColor({ White: 'a', Black: 'b' }, 'c')).toBeNull();
  });
});

describe('planGameImport', () => {
  it('returns null when no game matches the username', () => {
    const pgn = '[White "alice"]\n[Black "bob"]\n\n1. e4 e5 *';
    expect(planGameImport(pgn, 'carol')).toBeNull();
  });

  it('resolves is_player_turn per game from whichever side matches the username', () => {
    const pgn =
      '[White "carol"]\n[Black "bob"]\n\n1. e4 e5 *\n\n[White "bob"]\n[Black "carol"]\n\n1. d4 d5 *';
    const result = planGameImport(pgn, 'carol');
    expect(result).not.toBeNull();
    expect(result!.matchedGameCount).toBe(2);
    // Game 1: carol is White — her move (e4) is the player move.
    expect(result!.moves[0]).toMatchObject({ san: 'e4', is_player_turn: true });
    expect(result!.moves[1]).toMatchObject({ san: 'e5', is_player_turn: false });
    // Game 2: carol is Black — her move (d5) is the player move.
    expect(result!.moves[2]).toMatchObject({ san: 'd4', is_player_turn: false });
    expect(result!.moves[3]).toMatchObject({ san: 'd5', is_player_turn: true });
    expect(result!.studiedColor).toBe('white'); // from the first matched game
  });

  it('skips games where neither side matches, keeping only the matched ones', () => {
    const pgn =
      '[White "alice"]\n[Black "bob"]\n\n1. e4 e5 *\n\n[White "carol"]\n[Black "bob"]\n\n1. d4 d5 *';
    const result = planGameImport(pgn, 'carol');
    expect(result).not.toBeNull();
    expect(result!.matchedGameCount).toBe(1);
    expect(result!.moves).toHaveLength(2);
    expect(result!.moves[0].san).toBe('d4');
  });
});
