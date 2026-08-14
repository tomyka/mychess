import { describe, it, expect } from 'vitest';
import { planMultiImport, chapterName, planGameImport, resolvePlayerColor } from './pgn-import';

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
  // synthetic PGN longer than any real repertoire line under test.
  function knightShufflePgn(fullMoves: number): string {
    return Array.from({ length: fullMoves }, (_, i) => {
      const out = i % 2 === 0;
      return `${i + 1}. ${out ? 'Nf3 Nf6' : 'Ng1 Ng8'}`;
    }).join(' ');
  }

  it('imports every move uncapped, regardless of how deep a line runs', () => {
    const result = planMultiImport(`${knightShufflePgn(25)} *`, 'white');
    if ('error' in result) throw new Error('expected chapters, got error: ' + result.error);
    const playerMoves = result[0].moves.filter((m) => m.is_player_turn);
    expect(playerMoves).toHaveLength(25); // not truncated at any fixed cap
  });

  it('marks a chapter\'s own final move as isChapterEnd', () => {
    const result = planMultiImport('1. e4 e5 2. Nf3 *', 'white');
    if ('error' in result) throw new Error('expected chapters, got error: ' + result.error);
    const moves = result[0].moves;
    expect(moves.map((m) => m.isChapterEnd)).toEqual([false, false, true]);
  });

  it('marks every distinct leaf when a chapter has its own internal branch', () => {
    // 1.e4 e5 2.Nf3 Nc6 (2...Nf6 3.Nxe5) 3.Bb5 — two lines within ONE
    // chapter: the mainline ending on Bb5, and the sideline ending on Nxe5.
    // Both are leaves of this chapter's own move graph and must both be
    // tagged, since grouping-by-chapter must not silently drop the sideline
    // out of the picker's checkbox list.
    const pgn = '1. e4 e5 2. Nf3 Nc6 (2... Nf6 3. Nxe5) 3. Bb5 *';
    const result = planMultiImport(pgn, 'white');
    if ('error' in result) throw new Error('expected chapters, got error: ' + result.error);
    const moves = result[0].moves;
    const bb5 = moves.find((m) => m.san === 'Bb5');
    const nxe5 = moves.find((m) => m.san === 'Nxe5');
    const nc6 = moves.find((m) => m.san === 'Nc6');
    expect(bb5?.isChapterEnd).toBe(true);
    expect(nxe5?.isChapterEnd).toBe(true);
    expect(nc6?.isChapterEnd).toBe(false); // has an outgoing move (Bb5), not a leaf
  });

  it('does not mark a mid-chapter move as isChapterEnd', () => {
    const result = planMultiImport('1. e4 e5 2. Nf3 Nc6 *', 'white');
    if ('error' in result) throw new Error('expected chapters, got error: ' + result.error);
    const moves = result[0].moves;
    expect(moves[0].isChapterEnd).toBe(false); // e4
    expect(moves[moves.length - 1].isChapterEnd).toBe(true); // Nc6, the real last move
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

  it('falls back to Black when neither Event nor White is usable', () => {
    // ChessBase reference/study exports vary on which of White/Black gets
    // the real chapter title and which gets a fixed placeholder — some
    // files put it in White (covered above), others in Black.
    expect(chapterName({ Event: '?', White: '?', Black: 'Philidor' }, 0)).toBe('Philidor');
  });

  it('falls back to a plain ordinal when none of Event, White, or Black is usable', () => {
    expect(chapterName({ Event: '?', White: '?', Black: '?' }, 2)).toBe('Game 3');
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
