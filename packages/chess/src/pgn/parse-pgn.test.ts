import { describe, expect, it } from 'vitest';
import { parsePgn, type PgnGraph, type PgnMove } from './parse-pgn';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -';

function graphOf(pgn: string): PgnGraph {
  const result = parsePgn(pgn);
  if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.refusal)}`);
  return result.value;
}

function movesNamed(graph: PgnGraph, san: string): PgnMove[] {
  return graph.moves.filter((move) => move.san === san);
}

function only(graph: PgnGraph, san: string): PgnMove {
  const found = movesNamed(graph, san);
  expect(found).toHaveLength(1);
  const [move] = found;
  if (move === undefined) throw new Error(`no move ${san}`);
  return move;
}

describe('parsePgn: the move graph', () => {
  it('keys each move by the positions before and after it', () => {
    const graph = graphOf('1. e4 e5 *');
    expect(graph.moves).toEqual([
      {
        from: START,
        to: AFTER_E4,
        san: 'e4',
        pgnComments: [],
        nags: [],
        arrows: [],
        circles: [],
        games: [0],
      },
      {
        from: AFTER_E4,
        to: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -',
        san: 'e5',
        pgnComments: [],
        nags: [],
        arrows: [],
        circles: [],
        games: [0],
      },
    ]);
  });

  it('branches a variation from the position before the move it replaces', () => {
    const graph = graphOf('1. e4 e5 (1... c5 2. Nf3 d6) 2. Nf3 Nc6 *');
    const replies = graph.moves.filter((move) => move.from === AFTER_E4);
    expect(replies.map((move) => move.san)).toEqual(['e5', 'c5']);
    expect(graph.moves.map((move) => move.san)).toEqual([
      'e4',
      'e5',
      'c5',
      'Nf3',
      'd6',
      'Nf3',
      'Nc6',
    ]);
  });

  it('resumes the right branch after nested variations', () => {
    const graph = graphOf(
      '1. e4 e5 (1... c5 2. Nf3 (2. c3 d5) 2... d6) 2. Nf3 Nc6 *',
    );
    const c5 = only(graph, 'c5');
    expect(only(graph, 'c3').from).toBe(c5.to);
    expect(only(graph, 'd5').from).toBe(only(graph, 'c3').to);
    const d6 = only(graph, 'd6');
    const nf3AfterC5 = graph.moves.find(
      (move) => move.san === 'Nf3' && move.from === c5.to,
    );
    expect(d6.from).toBe(nf3AfterC5?.to);
    expect(only(graph, 'Nc6').from).not.toBe(d6.to);
  });

  it('merges a transposition within one game into one position', () => {
    const graph = graphOf(
      '1. d4 (1. c4 e6 2. d4 Nf6 3. Nc3) 1... Nf6 2. c4 e6 3. Nc3 *',
    );
    const nc3 = only(graph, 'Nc3');
    expect(nc3.from).toBe(
      'rnbqkb1r/pppp1ppp/4pn2/8/2PP4/8/PP2PPPP/RNBQKBNR w KQkq -',
    );
  });

  it('merges a transposition across games, listing both games', () => {
    const graph = graphOf(
      '1. d4 Nf6 2. c4 e6 3. Nc3 *\n\n1. c4 e6 2. d4 Nf6 3. Nc3 *',
    );
    expect(only(graph, 'Nc3').games).toEqual([0, 1]);
    expect(movesNamed(graph, 'd4').map((move) => move.games)).toEqual([
      [0],
      [1],
    ]);
  });

  it('lists a game once for a move it reaches twice', () => {
    const graph = graphOf('1. e4 (1. e4 c5) 1... e5 *');
    expect(only(graph, 'e4').games).toEqual([0]);
  });

  it('keeps positions apart that differ only in the en passant square', () => {
    const graph = graphOf(
      '1. e4 a6 (1... d5 2. e5 a6 3. Nf3) 2. e5 d5 3. Nf3 *',
    );
    expect(movesNamed(graph, 'Nf3').map((move) => move.from)).toEqual([
      'rnbqkbnr/1pp1pppp/p7/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq -',
      'rnbqkbnr/1pp1pppp/p7/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6',
    ]);
  });

  it('merges a return to the start, but not one that lost castling rights', () => {
    const graph = graphOf(
      '1. Nf3 Nf6 2. Ng1 (2. Rg1 Ng8 3. Rh1 Nf6 4. Ng1 Ng8) 2... Ng8 *',
    );
    expect(movesNamed(graph, 'Ng8').map((move) => move.to)).toEqual([
      'rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKBR1 w Qkq -',
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w Qkq -',
      START,
    ]);
  });

  it('starts from a FEN header and stores moves in canonical SAN', () => {
    const graph = graphOf(
      '[SetUp "1"]\n[FEN "8/P7/8/8/8/8/8/k6K w - - 0 1"]\n\n1. a8Q *',
    );
    expect(graph.games[0]?.root).toBe('8/P7/8/8/8/8/8/k6K w - -');
    expect(graph.moves.map((move) => move.san)).toEqual(['a8=Q+']);
  });

  it('tolerates spaces around a FEN header value', () => {
    const graph = graphOf('[FEN " 8/P7/8/8/8/8/8/k6K w - - 0 1 "] 1. a8=Q *');
    expect(graph.games[0]?.root).toBe('8/P7/8/8/8/8/8/k6K w - -');
  });

  it('merges a FEN header root with the same position reached by moves', () => {
    const graph = graphOf(
      [
        '1. e4 e5 *',
        '[FEN "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1"]',
        '1... e5 *',
      ].join('\n'),
    );
    expect(graph.games[1]?.root).toBe(AFTER_E4);
    expect(only(graph, 'e5').games).toEqual([0, 1]);
  });

  it('accepts castling written with zeros', () => {
    const graph = graphOf(
      '[FEN "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1"]\n\n1. 0-0 0-0-0 *',
    );
    expect(graph.moves.map((move) => move.san)).toEqual(['O-O', 'O-O-O']);
  });
});

describe('parsePgn: comments and NAGs', () => {
  it('attaches comments, suffix glyphs and NAGs to the move they follow', () => {
    const graph = graphOf('1. e4! {best by test} $14 e5 *');
    expect(only(graph, 'e4')).toMatchObject({
      pgnComments: ['best by test'],
      nags: [1, 14],
    });
    expect(only(graph, 'e5')).toMatchObject({ pgnComments: [], nags: [] });
  });

  it('attaches a comment before the first move of a variation to that move', () => {
    const graph = graphOf('1. e4 ({or} 1. d4) *');
    expect(only(graph, 'd4').pgnComments).toEqual(['or']);
  });

  it('keeps a comment that is only a clock off the move', () => {
    const graph = graphOf('1. e4 { [%clk 0:05:00] } {} e5 *');
    expect(only(graph, 'e4').pgnComments).toEqual([]);
  });

  it('unites the comments and NAGs of a move reached twice, without repeats', () => {
    const graph = graphOf('1. e4 {a} $1 *\n\n1. e4 {a} $1 {b} $3 *');
    expect(only(graph, 'e4')).toMatchObject({
      pgnComments: ['a', 'b'],
      nags: [1, 3],
    });
  });
});

describe('parsePgn: arrows and circles (R-65)', () => {
  it('keeps arrows on the move they follow', () => {
    const graph = graphOf('1. e4 { [%cal Gg1f3] } e5 *');
    expect(only(graph, 'e4')).toMatchObject({
      pgnComments: [],
      arrows: [{ from: 'g1', to: 'f3', color: 'G' }],
      circles: [],
    });
    expect(only(graph, 'e5')).toMatchObject({ arrows: [], circles: [] });
  });

  it('keeps the prose of a comment next to its marks', () => {
    const graph = graphOf('1. e4 {Main idea [%csl Rd5] [%clk 0:03:00]} *');
    expect(only(graph, 'e4')).toMatchObject({
      pgnComments: ['Main idea'],
      circles: [{ square: 'd5', color: 'R' }],
    });
  });

  it('collects the marks of several comments on one move', () => {
    const graph = graphOf('1. e4 {[%cal Gg1f3]} {[%cal Rd7d5][%csl Yd5]} *');
    expect(only(graph, 'e4')).toMatchObject({
      arrows: [
        { from: 'g1', to: 'f3', color: 'G' },
        { from: 'd7', to: 'd5', color: 'R' },
      ],
      circles: [{ square: 'd5', color: 'Y' }],
    });
  });

  it("gives marks before a variation's first move to that move", () => {
    const graph = graphOf('1. e4 ({[%cal Gc2c4]} 1. d4) *');
    expect(only(graph, 'd4').arrows).toEqual([
      { from: 'c2', to: 'c4', color: 'G' },
    ]);
  });

  it('unites the marks of a move reached twice, without repeats', () => {
    const graph = graphOf(
      [
        '1. e4 {[%cal Gg1f3][%csl Rd5]} *',
        '1. e4 {[%cal Gg1f3,Bb1c3][%csl Rd5]} *',
      ].join('\n\n'),
    );
    expect(only(graph, 'e4')).toMatchObject({
      arrows: [
        { from: 'g1', to: 'f3', color: 'G' },
        { from: 'b1', to: 'c3', color: 'B' },
      ],
      circles: [{ square: 'd5', color: 'R' }],
    });
  });
});

describe('parsePgn: the game intro (R-66)', () => {
  it('keeps a comment before the first move as the game intro', () => {
    const graph = graphOf('{ The Italian } 1. e4 e5 *');
    expect(graph.games[0]?.intro).toBe('The Italian');
    expect(only(graph, 'e4').pgnComments).toEqual([]);
  });

  it('has no intro when no comment comes before the first move', () => {
    expect(graphOf('1. e4 {best} *').games[0]?.intro).toBeNull();
  });

  it('joins several comments before the first move', () => {
    expect(graphOf('{One.} {Two.} 1. e4 *').games[0]?.intro).toBe('One. Two.');
  });

  it('drops commands from the intro, and an intro that is only commands', () => {
    expect(graphOf('{[%csl Gd4] Centre} 1. e4 *').games[0]?.intro).toBe(
      'Centre',
    );
    expect(graphOf('{[%csl Gd4]} 1. e4 *').games[0]?.intro).toBeNull();
  });

  it('keeps NAGs before the first move on that move', () => {
    const graph = graphOf('{Intro} $1 1. e4 *');
    expect(graph.games[0]?.intro).toBe('Intro');
    expect(only(graph, 'e4').nags).toEqual([1]);
  });

  it('keeps an intro per game, after a FEN start too', () => {
    const graph = graphOf(
      [
        '[Event "A"]\n\n{Open} 1. e4 *',
        '[Event "B"]\n[FEN "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1"]\n\n{ From e4 } 1... c5 *',
      ].join('\n\n'),
    );
    expect(graph.games.map((game) => game.intro)).toEqual(['Open', 'From e4']);
  });
});

describe('parsePgn: games', () => {
  it('lists each game with its headers', () => {
    const graph = graphOf(
      [
        '[Event "Najdorf"]',
        '[White "?"]',
        '',
        '1. e4 c5 *',
        '',
        '[Event "Caro-Kann"]',
        '',
        '1. e4 c6 *',
      ].join('\r\n'),
    );
    expect(graph.games).toEqual([
      {
        name: 'Najdorf',
        headers: { Event: 'Najdorf', White: '?' },
        root: START,
        intro: null,
      },
      {
        name: 'Caro-Kann',
        headers: { Event: 'Caro-Kann' },
        root: START,
        intro: null,
      },
    ]);
  });

  it('splits games on tags even without a blank line or result', () => {
    const graph = graphOf('[Event "A"]\n1. e4\n[Event "B"]\n1. d4');
    expect(graph.games.map((game) => game.name)).toEqual(['A', 'B']);
    expect(only(graph, 'd4').games).toEqual([1]);
  });

  it('splits header-less games on their results', () => {
    const graph = graphOf('1. e4 * 1. d4 1-0');
    expect(graph.games).toHaveLength(2);
    expect(only(graph, 'd4').games).toEqual([1]);
  });

  it('skips a game without moves, numbering games without it', () => {
    const graph = graphOf('[Event "Empty"]\n\n*\n\n[Event "Real"]\n\n1. e4 *');
    expect(graph.games.map((game) => game.name)).toEqual(['Real']);
    expect(only(graph, 'e4').games).toEqual([0]);
  });

  it('names games by White, then Black, when Event is shared by every game', () => {
    const graph = graphOf(
      [
        '[Event "My repertoire"][White "Sicilian"][Black "x"] 1. e4 c5 *',
        '[Event "My repertoire"][White "?"][Black "French"] 1. e4 e6 *',
        '[Event "My repertoire"][White ""][Black ""] 1. e4 e5 *',
      ].join('\n'),
    );
    expect(graph.games.map((game) => game.name)).toEqual([
      'Sicilian',
      'French',
      null,
    ]);
  });

  it('leaves a game unnamed when its headers repeat in other games', () => {
    const graph = graphOf(
      [
        '[White "Me"][Black "You"] 1. e4 *',
        '[White "Me"][Black "You"] 1. d4 *',
      ].join('\n'),
    );
    expect(graph.games.map((game) => game.name)).toEqual([null, null]);
  });

  it('passes over the "?" placeholder when naming a game', () => {
    const graph = graphOf('[Event "?"][White "Sicilian"] 1. e4 c5 *');
    expect(graph.games[0]?.name).toBe('Sicilian');
  });

  it('trims a header value before naming a game by it', () => {
    const graph = graphOf('[Event "  Scotch  "] 1. e4 *');
    expect(graph.games[0]?.name).toBe('Scotch');
  });
});

describe('parsePgn: refusals', () => {
  it('refuses an illegal move, naming the game and the move', () => {
    expect(parsePgn('1. e4 * 1. d4 Ke7 *')).toEqual({
      ok: false,
      refusal: { reason: 'pgn.illegalMove', game: 1, san: 'Ke7' },
    });
  });

  it('does not count a stray result as a game when naming the game refused', () => {
    expect(parsePgn('1. e4 * * 1. d4 Ke7 *')).toEqual({
      ok: false,
      refusal: { reason: 'pgn.illegalMove', game: 1, san: 'Ke7' },
    });
  });

  it('refuses words that are not moves', () => {
    expect(parsePgn('not valid pgn at all...')).toEqual({
      ok: false,
      refusal: { reason: 'pgn.illegalMove', game: 0, san: 'not' },
    });
  });

  it('refuses an invalid FEN header', () => {
    expect(parsePgn('[Event "A"] 1. e4 * [FEN "nonsense"] 1. e4 *')).toEqual({
      ok: false,
      refusal: { reason: 'pgn.invalidFen', game: 1 },
    });
  });

  it.each([
    ['an unmatched close', '1. e4 e5) *'],
    ['an unclosed variation', '1. e4 (1. d4 *'],
  ])('refuses %s', (_, pgn) => {
    expect(parsePgn(pgn)).toEqual({
      ok: false,
      refusal: { reason: 'pgn.unbalancedVariation', game: 0 },
    });
  });

  it('refuses a variation before any move of its branch', () => {
    expect(parsePgn('(1. d4) 1. e4 *')).toEqual({
      ok: false,
      refusal: { reason: 'pgn.variationWithoutMove', game: 0 },
    });
  });

  it('refuses text the tokenizer cannot read', () => {
    expect(parsePgn('1. e4 {')).toEqual({
      ok: false,
      refusal: { reason: 'pgn.unreadable', offset: 6 },
    });
  });

  it.each([
    ['empty text', ''],
    ['headers only', '[Event "A"]\n\n*'],
  ])('refuses %s as having no moves', (_, pgn) => {
    expect(parsePgn(pgn)).toEqual({
      ok: false,
      refusal: { reason: 'pgn.noMoves' },
    });
  });
});
