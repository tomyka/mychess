import { describe, expect, it } from 'vitest';
import { imported, must, AFTER_E4_E5_TAG } from '../pgn/test-support';
import { START_KEY } from '../position-key';
import type { Chapter, RepertoireGraph } from './graph';
import { ecoName } from '../openings/classify';
import {
  chapterOpening,
  namedByMoves,
  renamedByMoves,
  taxonomyNamed,
  taxonomyNames,
} from './naming';

const graphOf = (text: string): RepertoireGraph => imported(text).graph;
const chapter = (nameSource: Chapter['nameSource']): Chapter => ({
  id: 'c1',
  rootKey: START_KEY,
  intro: null,
  nameSource,
});

describe('taxonomyNamed (R-63)', () => {
  const line = graphOf('1. e4 e5 2. Nf3 *').moves;

  it('names a chapter after the deepest opening of its main line', () => {
    expect(taxonomyNamed(chapter({ kind: 'index', number: 4 }), line)).toEqual(
      chapter({ kind: 'eco', eco: 'C40' }),
    );
  });

  it('leaves a chapter whose line matches no opening as it was', () => {
    const numbered = chapter({ kind: 'index', number: 4 });
    expect(taxonomyNamed(numbered, [])).toBe(numbered);
  });
});

describe('namedByMoves (R-104)', () => {
  const others = [
    { ...chapter({ kind: 'index', number: 6 }), id: 'c2' },
    { ...chapter({ kind: 'custom', name: 'x' }), id: 'c3' },
  ];

  it('counts the other chapters, not the chapter itself', () => {
    const lost = chapter({ kind: 'eco', eco: 'B00' });
    const named = [
      { ...chapter({ kind: 'custom', name: 'a' }), id: 'c2' },
      { ...chapter({ kind: 'custom', name: 'b' }), id: 'c3' },
    ];
    expect(namedByMoves(lost, [], [lost, ...named]).nameSource).toEqual({
      kind: 'index',
      number: 3,
    });
  });

  it('numbers a chapter that lost its opening past the other chapters', () => {
    expect(
      namedByMoves(chapter({ kind: 'eco', eco: 'B00' }), [], others),
    ).toEqual(chapter({ kind: 'index', number: 7 }));
  });

  it('keeps the number of a chapter still too short to classify', () => {
    const numbered = chapter({ kind: 'index', number: 2 });
    expect(namedByMoves(numbered, [], others)).toBe(numbered);
  });
});

describe('renamedByMoves', () => {
  it('returns the same graph for an unknown chapter or an unchanged name', () => {
    // From a set-up position the chapter is not classified and keeps its number.
    const g = graphOf(`${AFTER_E4_E5_TAG}\n\n2. a3 *`);
    expect(g.chapters[0]?.nameSource).toEqual({ kind: 'index', number: 1 });
    expect(renamedByMoves(g, 'c9')).toBe(g);
    expect(renamedByMoves(g, 'c1')).toBe(g);
  });

  it('renames the chapter by its moves and keeps the rest', () => {
    const g = graphOf('1. e4 *');
    const numbered: RepertoireGraph = {
      ...g,
      chapters: [chapter({ kind: 'index', number: 1 })],
    };
    const renamed = renamedByMoves(numbered, 'c1');
    expect(must(renamed.chapters[0]).nameSource).toEqual({
      kind: 'eco',
      eco: 'B00',
    });
    expect(renamed.moves).toBe(numbered.moves);
  });
});

describe('taxonomyNamed keeps an unchanged name', () => {
  it('returns the same chapter when its code is unchanged', () => {
    const line = graphOf('1. e4 e5 2. Nf3 *').moves;
    const named = chapter({ kind: 'eco', eco: 'C40' });
    expect(taxonomyNamed(named, line)).toBe(named);
  });

  it('keeps an unchanged taxonomy name when the moves change (R-104)', () => {
    const line = graphOf('1. e4 e5 2. Nf3 *').moves;
    const named = chapter({ kind: 'eco', eco: 'C40' });
    expect(namedByMoves(named, line, [named])).toBe(named);
  });

  it('returns the same graph for an unchanged taxonomy name', () => {
    const g = graphOf('1. e4 e5 2. Nf3 *');
    expect(g.chapters[0]?.nameSource).toEqual({ kind: 'eco', eco: 'C40' });
    expect(renamedByMoves(g, 'c1')).toBe(g);
  });
});

describe('chapterOpening (R-216)', () => {
  it('reads the named line from the main line, transpositions included', () => {
    const g = graphOf(
      '1. d4 Nf6 2. c4 e6 3. g3 d5 4. Bg2 Be7 5. Nf3 O-O 6. O-O dxc4 *',
    );
    expect(chapterOpening(must(g.chapters[0]), g.moves)).toMatchObject({
      code: 'E05',
      name: 'Catalan Opening: Open Defense, Classical Line',
    });
  });

  it('is null for a chapter not rooted at the standard start', () => {
    const g = graphOf(`${AFTER_E4_E5_TAG}\n\n2. Nf3 *`);
    expect(chapterOpening(must(g.chapters[0]), g.moves)).toBeNull();
  });

  it('is null for a chapter without moves', () => {
    expect(
      chapterOpening(chapter({ kind: 'index', number: 1 }), []),
    ).toBeNull();
  });
});

describe('taxonomyNames (R-216)', () => {
  const withNameSource = (
    graph: RepertoireGraph,
    nameSource: Chapter['nameSource'],
  ): RepertoireGraph => ({
    ...graph,
    chapters: graph.chapters.map((c) => ({ ...c, nameSource })),
  });

  it('names an ECO chapter by the deepest named line of its main line', () => {
    const graph = graphOf('1. e4 c6 2. d4 d5 3. e5 Bf5 *');
    expect(graph.chapters[0]?.nameSource).toEqual({ kind: 'eco', eco: 'B12' });
    expect([...taxonomyNames(graph)]).toEqual([
      ['c1', 'Caro-Kann Defense: Advance Variation'],
    ]);
  });

  it('falls back to the stored code when the main line reaches no named line', () => {
    const graph = withNameSource(graphOf(`${AFTER_E4_E5_TAG}\n\n2. a3 c5 *`), {
      kind: 'eco',
      eco: 'B12',
    });
    expect([...taxonomyNames(graph)]).toEqual([['c1', ecoName('B12')]]);
    expect(ecoName('B12')).toBe('Caro-Kann Defense');
  });

  it('leaves custom, header and numbered chapters out', () => {
    const graph = graphOf('1. e4 c6 *');
    for (const nameSource of [
      { kind: 'custom', name: 'Mine' },
      { kind: 'header', name: 'Event' },
      { kind: 'index', number: 1 },
    ] as const) {
      expect(taxonomyNames(withNameSource(graph, nameSource)).size).toBe(0);
    }
  });
});
