import {
  ecoName,
  exportPgn,
  importPgn,
  START_KEY,
  type Chapter,
  type ChapterNameSource,
  type RepertoireGraph,
} from '@mychess/chess';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { LOCALE, MESSAGES } from '../i18n/catalogue';
import { plainChapterLabel } from '../lib/chapter-label';
import {
  chapterLabelOf,
  chapterNamesOf,
  chapterTitlesOf,
  plainChapterTitle,
} from './chapter-names';

const chapter = (id: string, nameSource: ChapterNameSource): Chapter => ({
  id,
  rootKey: START_KEY,
  intro: null,
  nameSource,
});

const GRAPH: RepertoireGraph = {
  side: 'white',
  chapters: [
    chapter('c1', { kind: 'eco', eco: 'D02' }),
    chapter('c2', { kind: 'custom', name: 'Mano Londonas' }),
    chapter('c3', { kind: 'header', name: 'London vs KID' }),
    chapter('c4', { kind: 'index', number: 4 }),
    chapter('c5', { kind: 'eco', eco: 'B46' }),
    chapter('c6', { kind: 'eco', eco: 'Z99' }),
  ],
  moves: [],
};

describe('plainChapterTitle', () => {
  it('names each kind of chapter in English', () => {
    expect(GRAPH.chapters.map(plainChapterTitle(GRAPH))).toEqual([
      ecoName('D02'),
      'Mano Londonas',
      'London vs KID',
      'Chapter 4',
      ecoName('B46'),
      'Z99',
    ]);
  });

  it('is the browser’s plain title over the names the server sends', () => {
    const t = createTranslator({ locale: LOCALE, messages: MESSAGES });
    const browser = plainChapterLabel(
      (key, values) => t(key, values),
      chapterNamesOf(GRAPH),
    );
    expect(GRAPH.chapters.map(browser)).toEqual(
      GRAPH.chapters.map(plainChapterTitle(GRAPH)),
    );
  });
});

describe('chapterLabelOf', () => {
  it('tells apart chapters by the named line each main line reaches (R-158, R-216)', () => {
    const imported = importPgn(
      '1. e4 c6 2. d4 d5 3. e5 Bf5 *\n\n1. e4 c6 2. Nc3 d5 3. Nf3 Bg4 *',
      'black',
    );
    if (!imported.ok) throw new Error(imported.refusal.reason);
    const { graph } = imported.value;
    expect(graph.chapters.map(chapterLabelOf(graph))).toEqual([
      'Caro-Kann Defense: Advance Variation',
      'Caro-Kann Defense: Two Knights Attack, Mindeno Variation',
    ]);
  });

  it('keeps names no other chapter shares plain, and a chapter not in the graph', () => {
    const label = chapterLabelOf(GRAPH);
    expect(GRAPH.chapters.map(label)).toEqual(
      GRAPH.chapters.map(plainChapterTitle(GRAPH)),
    );
    expect(label(chapter('c9', { kind: 'index', number: 9 }))).toBe(
      'Chapter 9',
    );
  });
});

describe('chapterNamesOf', () => {
  it('names exactly the taxonomy-named chapters, by id, by their stored code when no line is reached', () => {
    expect(chapterNamesOf(GRAPH).taxonomyNames).toEqual({
      c1: ecoName('D02'),
      c5: ecoName('B46'),
      c6: 'Z99',
    });
  });

  it('is empty for a repertoire without chapters', () => {
    expect(chapterNamesOf({ ...GRAPH, chapters: [] })).toEqual({
      taxonomyNames: {},
      distinctions: {},
    });
  });

  it('sends each chapter’s distinction as a plain record (R-158)', () => {
    const imported = importPgn(
      '1. e4 c6 2. d4 d5 3. e5 Bf5 *\n\n1. e4 c6 2. Nc3 d5 3. Nf3 Bg4 *',
      'black',
    );
    if (!imported.ok) throw new Error(imported.refusal.reason);
    const names = chapterNamesOf(imported.value.graph);
    expect(names.distinctions).toEqual({
      c1: { eco: 'B12', firstMove: { ply: 2, san: 'd4', whiteFirst: true } },
      c2: { eco: 'B11', firstMove: { ply: 2, san: 'Nc3', whiteFirst: true } },
    });
    expect(JSON.parse(JSON.stringify(names))).toEqual(names);
  });
});

describe('taxonomy names (R-216)', () => {
  const graphOf = (pgn: string): RepertoireGraph => {
    const imported = importPgn(`${pgn} *`, 'black');
    if (!imported.ok) throw new Error(imported.refusal.reason);
    return imported.value.graph;
  };
  const ADVANCE = 'Caro-Kann Defense: Advance Variation';

  it('names a chapter by the deepest named line its main line reaches', () => {
    const graph = graphOf('1. e4 c6 2. d4 d5 3. e5');
    const [only] = graph.chapters;
    if (only === undefined) throw new Error('no chapter');
    expect(chapterNamesOf(graph).taxonomyNames).toEqual({
      [only.id]: ADVANCE,
    });
    expect(plainChapterTitle(graph)(only)).toBe(ADVANCE);
    expect(chapterLabelOf(graph)(only)).toBe(ADVANCE);
  });

  it('titles the PGN download with the derived name', () => {
    const graph = graphOf('1. e4 c6 2. d4 d5 3. e5');
    expect(exportPgn(graph, { title: plainChapterTitle })).toContain(
      `[Event "${ADVANCE}"]`,
    );
  });
});

describe('chapterTitlesOf', () => {
  it('titles every chapter by id, as the repertoire page does', () => {
    const second = chapter('c2', { kind: 'index', number: 2 });
    const graph: RepertoireGraph = {
      side: 'white',
      chapters: [chapter('c1', { kind: 'custom', name: 'Main line' }), second],
      moves: [],
    };
    expect(chapterTitlesOf(graph)).toEqual({
      c1: 'Main line',
      c2: chapterLabelOf(graph)(second),
    });
  });
});
