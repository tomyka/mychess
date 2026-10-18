import {
  ecoName,
  START_KEY,
  type Chapter,
  type ChapterNameSource,
  type RepertoireGraph,
} from '@mychess/chess';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../i18n/locales';
import { chapterTitle, chapterTitleIn, ecoNamesOf } from './chapter-names';

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
  ],
  moves: [],
};

const translator = (locale: 'lt' | 'en') =>
  createTranslator({ locale, messages: MESSAGES[locale] });

describe('chapterTitle', () => {
  it('names each kind of chapter in Lithuanian', () => {
    const title = chapterTitle(translator('lt'), 'lt');
    expect(GRAPH.chapters.map(title)).toEqual([
      ecoName('D02', 'lt'),
      'Mano Londonas',
      'London vs KID',
      '4 skyrius',
      ecoName('B46', 'lt'),
    ]);
  });

  it('names each kind of chapter in English', () => {
    const title = chapterTitle(translator('en'), 'en');
    expect(GRAPH.chapters.map(title)).toEqual([
      ecoName('D02', 'en'),
      'Mano Londonas',
      'London vs KID',
      'Chapter 4',
      ecoName('B46', 'en'),
    ]);
  });
});

describe('chapterTitleIn', () => {
  it('is chapterTitle with the locale’s own catalogue', () => {
    expect(GRAPH.chapters.map(chapterTitleIn('lt'))).toEqual(
      GRAPH.chapters.map(chapterTitle(translator('lt'), 'lt')),
    );
    expect(GRAPH.chapters.map(chapterTitleIn('en'))).toEqual(
      GRAPH.chapters.map(chapterTitle(translator('en'), 'en')),
    );
    expect(
      chapterTitleIn('en')(chapter('c9', { kind: 'index', number: 9 })),
    ).toBe('Chapter 9');
  });
});

describe('ecoNamesOf', () => {
  it('maps exactly the ECO codes the chapters use to their names', () => {
    expect(ecoNamesOf(GRAPH, 'en')).toEqual({
      D02: ecoName('D02', 'en'),
      B46: ecoName('B46', 'en'),
    });
    expect(ecoNamesOf(GRAPH, 'lt')).toEqual({
      D02: ecoName('D02', 'lt'),
      B46: ecoName('B46', 'lt'),
    });
    expect(ecoName('B46', 'lt')).not.toBe(ecoName('B46', 'en'));
  });

  it('is empty for a repertoire without ECO chapters', () => {
    expect(ecoNamesOf({ ...GRAPH, chapters: [] }, 'lt')).toEqual({});
  });
});
