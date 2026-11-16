import { isPlayerMove, moveKey, positionKey, START_KEY } from '@mychess/chess';
import { describe, expect, it } from 'vitest';
import {
  chapterKeys,
  importChapters,
  importChaptersFromPgn,
  moveKeyAt,
  repertoirePgn,
} from '../src/testing/personas/lines';
import {
  importPersonaRepertoire,
  readPersonaPgn,
} from '../src/testing/personas/pgn-files';
import { PERSONA_REPERTOIRES } from '../src/testing/personas/repertoires';

const ITALIAN = '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 Nf6';
const TWO_KNIGHTS = '1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. d3 Bc5 5. c3';
const PETROV = '1. e4 e5 2. Nf3 Nf6 3. Nxe5 d6';

const AFTER_E4_E5_NF3_NC6 = positionKey(
  'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
);
const AFTER_E4_E5_NF3_NF6 = positionKey(
  'rnbqkb1r/pppp1ppp/5n2/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
);

describe('repertoirePgn', () => {
  it('writes one game per chapter, named by its Event header', () => {
    expect(
      repertoirePgn([
        { name: 'Italian', lines: ['1. e4 e5'] },
        { name: 'Scotch', lines: ['1. e4 e5 2. Nf3'] },
      ]),
    ).toBe(
      '[Event "Italian"]\n\n1. e4 1... e5 *\n\n[Event "Scotch"]\n\n1. e4 1... e5 2. Nf3 *',
    );
  });

  it('writes several lines of a chapter as one game with variations where they part', () => {
    expect(
      repertoirePgn([
        { name: 'Sidelines', lines: ['1. d4 Nf6 2. c4 g6', '1. d4 f5 2. g3'] },
      ]),
    ).toBe(
      '[Event "Sidelines"]\n\n1. d4 1... Nf6 (1... f5 2. g3) 2. c4 2... g6 *',
    );
  });
});

describe('importChapters', () => {
  it('imports one chapter per doc label, in order, merging transpositions by position', () => {
    const { graph, chapterIds } = importChapters('white', [
      { name: 'Pianissimo', lines: [ITALIAN] },
      { name: 'Two Knights', lines: [TWO_KNIGHTS] },
    ]);
    expect([...chapterIds]).toEqual([
      ['Pianissimo', graph.chapters[0]?.id],
      ['Two Knights', graph.chapters[1]?.id],
    ]);
    expect(graph.chapters).toHaveLength(2);
    expect(graph.moves.filter((m) => m.from === AFTER_E4_E5_NF3_NC6)).toEqual([
      expect.objectContaining({
        san: 'Bc4',
        chapters: [...chapterIds.values()],
      }),
    ]);
  });

  it('keeps the moves of a several-line chapter in that one chapter', () => {
    const { graph } = importChapters('white', [
      { name: 'Sidelines', lines: ['1. d4 Nf6 2. c4 g6', '1. d4 f5 2. g3'] },
    ]);
    expect(graph.chapters).toHaveLength(1);
    expect(graph.moves.map((m) => m.san)).toEqual(
      expect.arrayContaining(['d4', 'Nf6', 'f5', 'c4', 'g6', 'g3']),
    );
  });

  it('throws when a line is illegal, so a typo never seeds a short repertoire', () => {
    expect(() =>
      importChapters('white', [{ name: 'Bad', lines: ['1. e4 e5 2. Ke3'] }]),
    ).toThrow(/Bad|pgn\./);
  });

  it('throws when a line gives a second answer (R-54) instead of dropping it', () => {
    expect(() =>
      importChapters('white', [
        { name: 'One', lines: ['1. e4 e5'] },
        { name: 'Two', lines: ['1. d4 d5'] },
      ]),
    ).toThrow(/pgn\.secondAnswer/);
  });
});

describe('chapterKeys', () => {
  const imported = importChapters('white', [
    { name: 'Italian', lines: [ITALIAN] },
    { name: 'Petrov', lines: [PETROV] },
  ]);

  it("lists the review keys of the player's moves in the chapter, shared ones included", () => {
    const keys = chapterKeys(imported, 'Petrov');
    expect(keys).toHaveLength(3);
    expect(keys[0]).toBe(moveKey(START_KEY, 'e4'));
    expect(keys.at(-1)).toBe(moveKey(AFTER_E4_E5_NF3_NF6, 'Nxe5'));
    const { graph } = imported;
    const players = graph.moves.filter((m) => isPlayerMove(graph, m));
    expect(players.map((m) => moveKey(m.from, m.san))).toEqual(
      expect.arrayContaining(keys),
    );
  });

  it('throws for a chapter the repertoire does not have', () => {
    expect(() => chapterKeys(imported, 'Ruy Lopez')).toThrow(/Ruy Lopez/);
  });
});

describe('moveKeyAt', () => {
  const graph = importChapters('white', [
    { name: 'Italian', lines: [ITALIAN] },
  ]);

  it("finds White's move by its number on the chapter's main line", () => {
    expect(moveKeyAt(graph, 'Italian', '2.Nf3')).toBe(
      moveKey(
        positionKey(
          'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
        ),
        'Nf3',
      ),
    );
  });

  it("finds Black's move by its number", () => {
    expect(moveKeyAt(graph, 'Italian', '2...Nc6')).toBe(
      moveKey(
        positionKey(
          'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2',
        ),
        'Nc6',
      ),
    );
  });

  it.each(['4.Nf6', '2...Nf3', '9.c3', 'c3', '4. c3'])(
    'throws when %j is not a move of the main line',
    (at) => {
      expect(() => moveKeyAt(graph, 'Italian', at)).toThrow(/Italian/);
    },
  );
});

describe('importChaptersFromPgn', () => {
  const DOC = [
    { name: 'Italian', lines: [ITALIAN] },
    { name: 'Petrov', lines: [PETROV] },
  ];
  const FILE =
    '[Event "Italian"]\n\n{Quiet.} 1. e4 e5 2. Nf3 Nc6 3. Bc4 $1 Bc5 4. c3 {d4 next.} Nf6 (4... d6 5. d4) *\n\n' +
    '[Event "Petrov"]\n\n1. e4 e5 2. Nf3 Nf6 3. Nxe5 d6 *';

  it("imports the file with its comments, NAGs and variations, chapters named by the doc's labels", () => {
    const { graph, chapterIds } = importChaptersFromPgn('white', DOC, FILE);
    expect([...chapterIds]).toEqual([
      ['Italian', graph.chapters[0]?.id],
      ['Petrov', graph.chapters[1]?.id],
    ]);
    expect(graph.chapters[0]?.intro).toBe('Quiet.');
    const c3 = graph.moves.find((m) => m.san === 'c3');
    expect(c3?.comment).toBe('d4 next.');
    expect(graph.moves.find((m) => m.san === 'Bc4')?.nags).toEqual([1]);
    expect(graph.moves.map((m) => m.san)).toContain('d4');
  });

  it("throws when the file's games are not the doc's chapters, in order", () => {
    const swapped = FILE.replace('"Italian"', '"Ruy"');
    expect(() => importChaptersFromPgn('white', DOC, swapped)).toThrow(
      /Ruy, Petrov/,
    );
  });

  it('throws when the file has lost a move of the doc', () => {
    const short = FILE.replace(' 3. Nxe5 d6', ' 3. Nxe5');
    expect(() => importChaptersFromPgn('white', DOC, short)).toThrow(/no d6/);
  });

  it('throws when the import skips a game of the file', () => {
    const bad = FILE.replace('3. Nxe5 d6', '3. Nxe5 d6 4. Ke3');
    expect(() => importChaptersFromPgn('white', DOC, bad)).toThrow(/Petrov/);
  });
});

describe('the persona PGN files', () => {
  it.each(PERSONA_REPERTOIRES.filter((r) => r.pgnFile !== undefined))(
    'hold every line of $name as its doc gives it, and import whole',
    (r) => {
      const imported = importPersonaRepertoire(r);
      expect(imported.imported.skipped).toEqual([]);
      expect(imported.graph.chapters).toHaveLength(r.chapters.length);
    },
  );

  it('are the two the docs say were imported with comments', () => {
    expect(
      PERSONA_REPERTOIRES.flatMap((r) =>
        r.pgnFile === undefined ? [] : [[r.handle, r.pgnFile]],
      ),
    ).toEqual([
      ['taimanov', 'persona-taimanov.pgn'],
      ['catalan', 'persona-katalonu.pgn'],
    ]);
    expect(readPersonaPgn('persona-katalonu.pgn')).toContain('$14');
  });
});
