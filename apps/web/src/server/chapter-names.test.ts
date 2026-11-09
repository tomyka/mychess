import {
  ecoName,
  importPgn,
  START_KEY,
  type Chapter,
  type ChapterNameSource,
  type RepertoireGraph,
} from '@mychess/chess';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { MESSAGES, resolveLocale } from '../i18n/locales';
import { plainChapterLabel } from '../lib/chapter-label';
import {
  chapterLabelIn,
  chapterNamesOf,
  plainChapterTitleIn,
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

describe('plainChapterTitleIn', () => {
  it('names a Lithuanian account’s chapters in English while only English is offered (R-180)', () => {
    expect(GRAPH.chapters.map(plainChapterTitleIn('lt'))).toEqual([
      ecoName('D02', 'en'),
      'Mano Londonas',
      'London vs KID',
      'Chapter 4',
      ecoName('B46', 'en'),
      'Z99',
    ]);
  });

  it('names each kind of chapter in English', () => {
    expect(GRAPH.chapters.map(plainChapterTitleIn('en'))).toEqual([
      ecoName('D02', 'en'),
      'Mano Londonas',
      'London vs KID',
      'Chapter 4',
      ecoName('B46', 'en'),
      'Z99',
    ]);
  });

  it('is the browser’s plain title over the names the server sends', () => {
    for (const locale of ['lt', 'en'] as const) {
      // The browser translates in the page's locale, the one served.
      const page = resolveLocale(locale);
      const t = createTranslator({ locale: page, messages: MESSAGES[page] });
      const browser = plainChapterLabel(
        (key, values) => t(key, values),
        chapterNamesOf(GRAPH, locale),
      );
      expect(GRAPH.chapters.map(browser)).toEqual(
        GRAPH.chapters.map(plainChapterTitleIn(locale)),
      );
    }
  });
});

describe('chapterLabelIn', () => {
  it('tells apart chapters that share a name, in the locale given (R-158)', () => {
    const imported = importPgn(
      '1. e4 c6 2. d4 d5 3. e5 Bf5 *\n\n1. e4 c6 2. Nc3 d5 3. Nf3 Bg4 *',
      'black',
    );
    if (!imported.ok) throw new Error(imported.refusal.reason);
    const { graph } = imported.value;
    // Lithuanian names both B12 and B11 "Karo-Kano gynyba"; English tells
    // them apart by name, and a Lithuanian account is served English.
    expect(ecoName('B12', 'lt')).toBe(ecoName('B11', 'lt'));
    for (const locale of ['lt', 'en'] as const)
      expect(graph.chapters.map(chapterLabelIn(graph, locale))).toEqual([
        ecoName('B12', 'en'),
        ecoName('B11', 'en'),
      ]);
  });

  it('keeps names no other chapter shares plain, and a chapter not in the graph', () => {
    const label = chapterLabelIn(GRAPH, 'en');
    expect(GRAPH.chapters.map(label)).toEqual(
      GRAPH.chapters.map(plainChapterTitleIn('en')),
    );
    expect(label(chapter('c9', { kind: 'index', number: 9 }))).toBe(
      'Chapter 9',
    );
  });
});

describe('chapterNamesOf', () => {
  it('maps exactly the ECO codes the chapters use to their names', () => {
    expect(chapterNamesOf(GRAPH, 'en').ecoNames).toEqual({
      D02: ecoName('D02', 'en'),
      B46: ecoName('B46', 'en'),
      Z99: 'Z99',
    });
    // A Lithuanian account gets the English names (R-180).
    expect(chapterNamesOf(GRAPH, 'lt').ecoNames).toEqual({
      D02: ecoName('D02', 'en'),
      B46: ecoName('B46', 'en'),
      Z99: 'Z99',
    });
    expect(ecoName('B46', 'lt')).not.toBe(ecoName('B46', 'en'));
  });

  it('is empty for a repertoire without chapters', () => {
    expect(chapterNamesOf({ ...GRAPH, chapters: [] }, 'lt')).toEqual({
      ecoNames: {},
      distinctions: {},
    });
  });

  it('sends each chapter’s distinction as a plain record (R-158)', () => {
    const imported = importPgn(
      '1. e4 c6 2. d4 d5 3. e5 Bf5 *\n\n1. e4 c6 2. Nc3 d5 3. Nf3 Bg4 *',
      'black',
    );
    if (!imported.ok) throw new Error(imported.refusal.reason);
    const names = chapterNamesOf(imported.value.graph, 'lt');
    expect(names.distinctions).toEqual({
      c1: { eco: 'B12', firstMove: { ply: 2, san: 'd4', whiteFirst: true } },
      c2: { eco: 'B11', firstMove: { ply: 2, san: 'Nc3', whiteFirst: true } },
    });
    expect(JSON.parse(JSON.stringify(names))).toEqual(names);
  });
});
