import { describe, expect, it } from 'vitest';
import { positionKey } from '../position-key';
import { oneEntryPerCode, parseEcoTsv, withPositionKeys } from './eco-tsv';

// The shape of lichess-org/chess-openings `a.tsv`: a header row, then
// `eco<TAB>name<TAB>pgn` with move numbers in the PGN.
const TSV = [
  'eco\tname\tpgn',
  'A00\tAmar Opening\t1. Nh3',
  'A00\tAmar Opening: Paris Gambit\t1. Nh3 d5 2. g3 e5 3. f4',
  'A03\tBird Opening: Dutch Variation\t1. f4 d5',
  '',
].join('\n');

describe('parseEcoTsv', () => {
  it('reads every row after the header into code, name and SAN moves', () => {
    expect(parseEcoTsv(TSV)).toEqual([
      { code: 'A00', name: 'Amar Opening', moves: ['Nh3'] },
      {
        code: 'A00',
        name: 'Amar Opening: Paris Gambit',
        moves: ['Nh3', 'd5', 'g3', 'e5', 'f4'],
      },
      {
        code: 'A03',
        name: 'Bird Opening: Dutch Variation',
        moves: ['f4', 'd5'],
      },
    ]);
  });

  it('drops black move numbers and keeps castling and checks', () => {
    const tsv = 'eco\tname\tpgn\nC99\tX\t1. e4 e5 2. Bc4 Nc6 3... O-O-O+';
    expect(parseEcoTsv(tsv)[0]?.moves).toEqual([
      'e4',
      'e5',
      'Bc4',
      'Nc6',
      'O-O-O+',
    ]);
  });

  it('reads Windows line endings', () => {
    expect(
      parseEcoTsv('eco\tname\tpgn\r\nA02\tBird Opening\t1. f4\r\n'),
    ).toEqual([{ code: 'A02', name: 'Bird Opening', moves: ['f4'] }]);
  });

  it('throws on a row without three columns: the source format changed', () => {
    expect(() => parseEcoTsv('eco\tname\tpgn\nA00\tAmar Opening')).toThrow(
      /A00\tAmar Opening/,
    );
  });
});

describe('oneEntryPerCode', () => {
  it('keeps the shortest line of each code, sorted by code', () => {
    const entries = [
      {
        code: 'B01',
        name: 'Scandinavian Defense: Mieses',
        moves: ['e4', 'd5', 'exd5', 'Qxd5'],
      },
      { code: 'A00', name: 'Amar Opening', moves: ['Nh3'] },
      { code: 'B01', name: 'Scandinavian Defense', moves: ['e4', 'd5'] },
    ];
    expect(oneEntryPerCode(entries)).toEqual([
      { code: 'A00', name: 'Amar Opening', moves: ['Nh3'] },
      { code: 'B01', name: 'Scandinavian Defense', moves: ['e4', 'd5'] },
    ]);
  });

  it('keeps the first of two equally short lines', () => {
    const entries = [
      { code: 'A00', name: 'Amar Opening', moves: ['Nh3'] },
      { code: 'A00', name: 'Ware Opening', moves: ['a4'] },
    ];
    expect(oneEntryPerCode(entries)).toEqual([
      { code: 'A00', name: 'Amar Opening', moves: ['Nh3'] },
    ]);
  });
});

describe('withPositionKeys', () => {
  it('adds the key of the position each line ends in', () => {
    const [entry] = withPositionKeys(
      [{ code: 'B00', name: "King's Pawn Game", moves: ['e4'] }],
      positionKey,
    );
    expect(entry).toEqual({
      code: 'B00',
      name: "King's Pawn Game",
      moves: ['e4'],
      key: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -',
    });
  });

  it('keys the position, not the move order: transpositions share a key', () => {
    const [a, b] = withPositionKeys(
      [
        { code: 'X', name: 'A', moves: ['Nf3', 'Nf6', 'd4'] },
        { code: 'X', name: 'B', moves: ['d4', 'Nf6', 'Nf3'] },
      ],
      positionKey,
    );
    expect(a?.key).toBe(
      'rnbqkb1r/pppppppp/5n2/8/3P4/5N2/PPP1PPPP/RNBQKB1R b KQkq -',
    );
    expect(b?.key).toBe(a?.key);
  });

  it('throws at an illegal move: the source data is broken', () => {
    expect(() =>
      withPositionKeys(
        [{ code: 'X99', name: 'Bad', moves: ['e4', 'Ke3'] }],
        positionKey,
      ),
    ).toThrow('ECO X99: illegal move Ke3');
  });
});
