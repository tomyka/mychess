import {
  START_KEY,
  type Chapter,
  type ChapterDistinction,
  type ChapterNameSource,
} from '@mychess/chess';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { LOCALE, MESSAGES } from '../i18n/catalogue';
import {
  chapterLabel,
  chapterTitles,
  plainChapterLabel,
  type ChapterNames,
  type ChapterTranslator,
} from './chapter-label';

const chapter = (id: string, nameSource: ChapterNameSource): Chapter => ({
  id,
  rootKey: START_KEY,
  intro: null,
  nameSource,
});

const translate = createTranslator({ locale: LOCALE, messages: MESSAGES });
const EN: ChapterTranslator = (key, values) => translate(key, values);

const move = (ply: number, san: string, whiteFirst = true) => ({
  ply,
  san,
  whiteFirst,
});

/** The coach persona's Caro-Kann: chapters 1 (B12) and 5 (B11), #301. */
const ADVANCE = chapter('c1', { kind: 'eco', eco: 'B12' });
const TWO_KNIGHTS = chapter('c5', { kind: 'eco', eco: 'B11' });
const KARO_KAN_DISTINCTIONS: Readonly<Record<string, ChapterDistinction>> = {
  c1: { eco: 'B12', firstMove: move(4, 'e5') },
  c5: { eco: 'B11', firstMove: move(2, 'Nc3') },
};

describe('chapterTitles (R-158)', () => {
  const caroKann = (): string => 'Caro-Kann Defense';

  it('gives chapters that share a title their ECO code and first move', () => {
    expect(
      chapterTitles(
        [ADVANCE, TWO_KNIGHTS],
        caroKann,
        KARO_KAN_DISTINCTIONS,
        EN,
      ),
    ).toEqual({
      c1: 'Caro-Kann Defense (B12, 3. e5)',
      c5: 'Caro-Kann Defense (B11, 2. Nc3)',
    });
  });

  it('keeps unique titles plain, beside a shared one', () => {
    const london = chapter('c2', { kind: 'custom', name: 'London' });
    const titles = chapterTitles(
      [ADVANCE, london, TWO_KNIGHTS],
      (c) => (c.id === 'c2' ? 'London' : 'Caro-Kann Defense'),
      {
        ...KARO_KAN_DISTINCTIONS,
        c2: { eco: 'D02', firstMove: move(0, 'd4') },
      },
      EN,
    );
    expect(titles).toEqual({
      c1: 'Caro-Kann Defense (B12, 3. e5)',
      c2: 'London',
      c5: 'Caro-Kann Defense (B11, 2. Nc3)',
    });
  });

  it('writes only the move without an ECO code, numbered from Black', () => {
    const a = chapter('a', { kind: 'custom', name: 'Mine' });
    const b = chapter('b', { kind: 'custom', name: 'Mine' });
    const distinctions = {
      a: { eco: null, firstMove: move(2, 'd5', false) },
      b: { eco: null, firstMove: move(0, 'c6', false) },
    };
    expect(chapterTitles([a, b], () => 'Mine', distinctions, EN)).toEqual({
      a: 'Mine (2... d5)',
      b: 'Mine (1... c6)',
    });
  });

  it('writes only the ECO code when no move of its own is left', () => {
    const a = chapter('a', { kind: 'eco', eco: 'B12' });
    const b = chapter('b', { kind: 'eco', eco: 'B12' });
    const distinctions = {
      a: { eco: 'B12', firstMove: null },
      b: { eco: 'B12', firstMove: move(5, 'Bf5') },
    };
    expect(chapterTitles([a, b], () => 'Caro', distinctions, EN)).toEqual({
      a: 'Caro (B12)',
      b: 'Caro (B12, 3... Bf5)',
    });
  });

  it('leaves a shared title as it is with neither, or without a distinction', () => {
    const a = chapter('a', { kind: 'custom', name: 'X' });
    const b = chapter('b', { kind: 'custom', name: 'X' });
    expect(
      chapterTitles(
        [a, b],
        () => 'X',
        { a: { eco: null, firstMove: null } },
        EN,
      ),
    ).toEqual({ a: 'X', b: 'X' });
  });
});

describe('chapterLabel', () => {
  const names = (
    distinctions: ChapterNames['distinctions'] = {},
  ): ChapterNames => ({
    taxonomyNames: {
      c1: 'London System',
      a: 'London System',
      b: 'London System',
    },
    distinctions,
  });

  it('names an ECO chapter from the names it was given, or by its code', () => {
    const d02 = chapter('c1', { kind: 'eco', eco: 'D02' });
    const a00 = chapter('c2', { kind: 'eco', eco: 'A00' });
    const label = chapterLabel(EN, names(), [d02, a00]);
    expect(label(d02)).toBe('London System');
    expect(label(a00)).toBe('A00');
  });

  it('keeps a custom or header name as it is', () => {
    const custom = chapter('c1', { kind: 'custom', name: 'Mine' });
    const header = chapter('c2', { kind: 'header', name: 'Event' });
    const label = chapterLabel(EN, names(), [custom, header]);
    expect(label(custom)).toBe('Mine');
    expect(label(header)).toBe('Event');
  });

  it('numbers an untitled chapter through the catalogue', () => {
    const third = chapter('c3', { kind: 'index', number: 3 });
    expect(chapterLabel(EN, names(), [third])(third)).toBe('Chapter 3');
  });

  it('tells apart two chapters named after the same opening', () => {
    const a = chapter('a', { kind: 'eco', eco: 'D02' });
    const b = chapter('b', { kind: 'eco', eco: 'D02' });
    const label = chapterLabel(
      EN,
      names({
        a: { eco: 'D02', firstMove: move(2, 'Bf4') },
        b: { eco: 'D02', firstMove: move(2, 'Nf3') },
      }),
      [a, b],
    );
    expect(label(a)).toBe('London System (D02, 2. Bf4)');
    expect(label(b)).toBe('London System (D02, 2. Nf3)');
  });

  it('names a chapter outside the list by its plain title', () => {
    const other = chapter('z', { kind: 'custom', name: 'Other' });
    expect(chapterLabel(EN, names(), [])(other)).toBe('Other');
  });
});

describe('plainChapterLabel (R-216)', () => {
  it('names a chapter by its own taxonomy name, by id, else by its code', () => {
    const advance = chapter('c1', { kind: 'eco', eco: 'B12' });
    const other = chapter('c2', { kind: 'eco', eco: 'B12' });
    const label = plainChapterLabel(EN, {
      taxonomyNames: { c1: 'Caro-Kann Defense: Advance Variation' },
      distinctions: {},
    });
    expect(label(advance)).toBe('Caro-Kann Defense: Advance Variation');
    expect(label(other)).toBe('B12');
  });
});
