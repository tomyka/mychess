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
        comments: [],
        nags: [],
        chapters: [0],
      },
      {
        from: AFTER_E4,
        to: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -',
        san: 'e5',
        comments: [],
        nags: [],
        chapters: [0],
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

  it('resumes the right line after nested variations', () => {
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

  it('merges a transposition across chapters, listing both chapters', () => {
    const graph = graphOf(
      '1. d4 Nf6 2. c4 e6 3. Nc3 *\n\n1. c4 e6 2. d4 Nf6 3. Nc3 *',
    );
    expect(only(graph, 'Nc3').chapters).toEqual([0, 1]);
    expect(movesNamed(graph, 'd4').map((move) => move.chapters)).toEqual([
      [0],
      [1],
    ]);
  });

  it('lists a chapter once for a move it reaches twice', () => {
    const graph = graphOf('1. e4 (1. e4 c5) 1... e5 *');
    expect(only(graph, 'e4').chapters).toEqual([0]);
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
    expect(graph.chapters[0]?.root).toBe('8/P7/8/8/8/8/8/k6K w - -');
    expect(graph.moves.map((move) => move.san)).toEqual(['a8=Q+']);
  });

  it('tolerates spaces around a FEN header value', () => {
    const graph = graphOf('[FEN " 8/P7/8/8/8/8/8/k6K w - - 0 1 "] 1. a8=Q *');
    expect(graph.chapters[0]?.root).toBe('8/P7/8/8/8/8/8/k6K w - -');
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
      comments: ['best by test'],
      nags: [1, 14],
    });
    expect(only(graph, 'e5')).toMatchObject({ comments: [], nags: [] });
  });

  it('attaches a comment before the first move of a line to that move', () => {
    const graph = graphOf('{intro} 1. e4 ({or} 1. d4) *');
    expect(only(graph, 'e4').comments).toEqual(['intro']);
    expect(only(graph, 'd4').comments).toEqual(['or']);
  });

  it('unites the comments and NAGs of a move reached twice, without repeats', () => {
    const graph = graphOf('1. e4 {a} $1 *\n\n1. e4 {a} $1 {b} $3 *');
    expect(only(graph, 'e4')).toMatchObject({
      comments: ['a', 'b'],
      nags: [1, 3],
    });
  });
});

describe('parsePgn: chapters', () => {
  it('makes one chapter per game, keeping its headers', () => {
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
    expect(graph.chapters).toEqual([
      {
        name: 'Najdorf',
        headers: { Event: 'Najdorf', White: '?' },
        root: START,
      },
      { name: 'Caro-Kann', headers: { Event: 'Caro-Kann' }, root: START },
    ]);
  });

  it('splits games on tags even without a blank line or result', () => {
    const graph = graphOf('[Event "A"]\n1. e4\n[Event "B"]\n1. d4');
    expect(graph.chapters.map((chapter) => chapter.name)).toEqual(['A', 'B']);
    expect(only(graph, 'd4').chapters).toEqual([1]);
  });

  it('splits header-less games on their results', () => {
    const graph = graphOf('1. e4 * 1. d4 1-0');
    expect(graph.chapters).toHaveLength(2);
    expect(only(graph, 'd4').chapters).toEqual([1]);
  });

  it('skips a game without moves, numbering chapters without it', () => {
    const graph = graphOf('[Event "Empty"]\n\n*\n\n[Event "Real"]\n\n1. e4 *');
    expect(graph.chapters.map((chapter) => chapter.name)).toEqual(['Real']);
    expect(only(graph, 'e4').chapters).toEqual([0]);
  });

  it('names chapters by White, then Black, when Event is shared by every game', () => {
    const graph = graphOf(
      [
        '[Event "My repertoire"][White "Sicilian"][Black "x"] 1. e4 c5 *',
        '[Event "My repertoire"][White "?"][Black "French"] 1. e4 e6 *',
        '[Event "My repertoire"][White ""][Black ""] 1. e4 e5 *',
      ].join('\n'),
    );
    expect(graph.chapters.map((chapter) => chapter.name)).toEqual([
      'Sicilian',
      'French',
      null,
    ]);
  });

  it('leaves a chapter unnamed when its headers repeat in other games', () => {
    const graph = graphOf(
      [
        '[White "Me"][Black "You"] 1. e4 *',
        '[White "Me"][Black "You"] 1. d4 *',
      ].join('\n'),
    );
    expect(graph.chapters.map((chapter) => chapter.name)).toEqual([null, null]);
  });

  it('passes over the "?" placeholder when naming a chapter', () => {
    const graph = graphOf('[Event "?"][White "Sicilian"] 1. e4 c5 *');
    expect(graph.chapters[0]?.name).toBe('Sicilian');
  });

  it('trims a header value before naming a chapter by it', () => {
    const graph = graphOf('[Event "  Scotch  "] 1. e4 *');
    expect(graph.chapters[0]?.name).toBe('Scotch');
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

  it('refuses a variation before any move of its line', () => {
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
