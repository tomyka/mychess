import { chapterTree, type RepertoireGraph } from '@mychess/chess';
import { describe, expect, it } from 'vitest';
import { graphOf, LONDON, TAIMANOV } from '../../../test/fixtures/repertoires';
import { lineTokens, rowsOf, type Row, type Token } from './move-rows';

/** After 1. e4 c5 2. Nf3 e6 3. d4 cxd4 4. Nxd4 Nc6 5. Nc3: Black to move. */
const TAIMANOV_FEN =
  'r1bqkbnr/pp1p1ppp/2n1p3/8/3NP3/2N5/PPP2PPP/R1BQKB1R b KQkq - 2 5';

/** A token's SAN, or its variations as "(...)" blocks. */
const tokenText = (token: Token): string =>
  token.kind === 'move'
    ? token.move.san
    : token.blocks
        .map((block) => `(${block.map(tokenText).join(' ')})`)
        .join(' ');

/** A row as "6. Be3 ..." for moves, "(...)" for variations. */
const rowText = (row: Row): string =>
  row.kind === 'moves'
    ? [row.number, row.white?.move.san ?? '…', row.black?.move.san ?? '']
        .join(' ')
        .trim()
    : tokenText(row);

function rowsFor(graph: RepertoireGraph, whiteFirst: boolean): string[] {
  return rowsOf(lineTokens(chapterTree(graph, 'c1'), 0, []), whiteFirst).map(
    rowText,
  );
}

describe('rowsOf', () => {
  it('pairs White’s and Black’s moves in numbered rows', () => {
    expect(rowsFor(graphOf('1. e4 c5 2. Nf3 e6 *'), true)).toEqual([
      '1. e4 c5',
      '2. Nf3 e6',
    ]);
  });

  it('closes a row at a variation and goes on with White on a new row', () => {
    expect(rowsFor(graphOf(LONDON), true)).toEqual([
      '1. d4 d5',
      '2. Bf4 Nf6',
      '3. e3 e6',
      '(c5 c3)',
      '4. Nf3',
    ]);
  });

  it('goes on with Black’s move after variations on White’s, with no White move', () => {
    expect(rowsFor(graphOf(TAIMANOV, 'black'), true)).toEqual([
      '1. e4 c5',
      '2. Nf3 e6',
      '3. d4 cxd4',
      '4. Nxd4 Nc6',
      '5. Nc3 Qc7',
      '6. Be3',
      '(Be2 a6 O-O (Be3 Nf6) Nf6) (g3 a6)',
      '6. … a6',
      '7. Qd2 Nf6',
    ]);
  });

  it('starts a chapter whose root has Black to move with Black’s move alone', () => {
    const graph = graphOf(
      `[FEN "${TAIMANOV_FEN}"]\n[SetUp "1"]\n\n5... Qc7 6. Be3 a6 *`,
      'black',
    );
    expect(rowsFor(graph, false)).toEqual(['1. … Qc7', '2. Be3 a6']);
  });

  it('keeps the main line’s rows going past a variation that transposes into it', () => {
    // 1... e6 2. c4 d5 reaches the main line's position after 2. c4 e6.
    const graph = graphOf('1. d4 d5 (1... e6 2. c4 d5) 2. c4 e6 3. Nc3 *');
    const rows = rowsOf(lineTokens(chapterTree(graph, 'c1'), 0, []), true);
    expect(rows.map(rowText)).toEqual([
      '1. d4 d5',
      '(e6 c4 d5)',
      '2. c4 e6',
      '3. Nc3',
    ]);
    const [variation] = rows[1]?.kind === 'variations' ? rows[1].blocks : [];
    expect(
      variation?.map((token) => token.kind === 'move' && token.transposes),
    ).toEqual([false, false, true]);
  });

  it('has no rows for an empty chapter', () => {
    expect(rowsOf([], true)).toEqual([]);
  });
});
