import { describe, expect, it } from 'vitest';
import { imported, must } from '../pgn/test-support';
import { START_KEY } from '../position-key';
import type { Chapter, RepertoireGraph } from './graph';
import { namedByMoves, renamedByMoves, taxonomyNamed } from './naming';

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
    const g = graphOf('1. a3 *');
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
