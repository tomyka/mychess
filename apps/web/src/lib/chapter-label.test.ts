import {
  START_KEY,
  type Chapter,
  type ChapterDistinction,
  type ChapterNameSource,
} from '@mychess/chess';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../i18n/locales';
import {
  chapterLabel,
  chapterTitles,
  type ChapterNames,
  type ChapterTranslator,
} from './chapter-label';

const chapter = (id: string, nameSource: ChapterNameSource): Chapter => ({
  id,
  rootKey: START_KEY,
  intro: null,
  nameSource,
});

const translator = (locale: 'lt' | 'en'): ChapterTranslator => {
  const t = createTranslator({ locale, messages: MESSAGES[locale] });
  return (key, values) => t(key, values);
};

const LT = translator('lt');
const EN = translator('en');

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
  const sameName = (): string => 'Karo-Kano gynyba';

  it('gives chapters that share a title their ECO code and first move', () => {
    expect(
      chapterTitles(
        [ADVANCE, TWO_KNIGHTS],
        sameName,
        KARO_KAN_DISTINCTIONS,
        LT,
      ),
    ).toEqual({
      c1: 'Karo-Kano gynyba (B12, 3.\u00A0e5)',
      c5: 'Karo-Kano gynyba (B11, 2.\u00A0Nc3)',
    });
  });

  it('writes the same form in English', () => {
    const caroKann = (): string => 'Caro-Kann Defense';
    expect(
      chapterTitles(
        [ADVANCE, TWO_KNIGHTS],
        caroKann,
        KARO_KAN_DISTINCTIONS,
        EN,
      ),
    ).toEqual({
      c1: 'Caro-Kann Defense (B12, 3.\u00A0e5)',
      c5: 'Caro-Kann Defense (B11, 2.\u00A0Nc3)',
    });
  });

  it('keeps unique titles plain, beside a shared one', () => {
    const london = chapter('c2', { kind: 'custom', name: 'Londonas' });
    const titles = chapterTitles(
      [ADVANCE, london, TWO_KNIGHTS],
      (c) => (c.id === 'c2' ? 'Londonas' : 'Karo-Kano gynyba'),
      {
        ...KARO_KAN_DISTINCTIONS,
        c2: { eco: 'D02', firstMove: move(0, 'd4') },
      },
      LT,
    );
    expect(titles).toEqual({
      c1: 'Karo-Kano gynyba (B12, 3.\u00A0e5)',
      c2: 'Londonas',
      c5: 'Karo-Kano gynyba (B11, 2.\u00A0Nc3)',
    });
  });

  it('writes only the move without an ECO code, numbered from Black', () => {
    const a = chapter('a', { kind: 'custom', name: 'Mano' });
    const b = chapter('b', { kind: 'custom', name: 'Mano' });
    const distinctions = {
      a: { eco: null, firstMove: move(2, 'd5', false) },
      b: { eco: null, firstMove: move(0, 'c6', false) },
    };
    expect(chapterTitles([a, b], () => 'Mano', distinctions, LT)).toEqual({
      a: 'Mano (2...\u00A0d5)',
      b: 'Mano (1...\u00A0c6)',
    });
    expect(chapterTitles([a, b], () => 'Mine', distinctions, EN)).toEqual({
      a: 'Mine (2...\u00A0d5)',
      b: 'Mine (1...\u00A0c6)',
    });
  });

  it('writes only the ECO code when no move of its own is left', () => {
    const a = chapter('a', { kind: 'eco', eco: 'B12' });
    const b = chapter('b', { kind: 'eco', eco: 'B12' });
    const distinctions = {
      a: { eco: 'B12', firstMove: null },
      b: { eco: 'B12', firstMove: move(5, 'Bf5') },
    };
    expect(chapterTitles([a, b], () => 'Karo', distinctions, LT)).toEqual({
      a: 'Karo (B12)',
      b: 'Karo (B12, 3...\u00A0Bf5)',
    });
    expect(chapterTitles([a, b], () => 'Caro', distinctions, EN)).toEqual({
      a: 'Caro (B12)',
      b: 'Caro (B12, 3...\u00A0Bf5)',
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
        LT,
      ),
    ).toEqual({ a: 'X', b: 'X' });
  });
});

describe('chapterLabel', () => {
  const names = (
    distinctions: ChapterNames['distinctions'] = {},
  ): ChapterNames => ({ ecoNames: { D02: 'Londono sistema' }, distinctions });

  it('names an ECO chapter from the names it was given, or by its code', () => {
    const d02 = chapter('c1', { kind: 'eco', eco: 'D02' });
    const a00 = chapter('c2', { kind: 'eco', eco: 'A00' });
    const label = chapterLabel(LT, names(), [d02, a00]);
    expect(label(d02)).toBe('Londono sistema');
    expect(label(a00)).toBe('A00');
  });

  it('keeps a custom or header name as it is', () => {
    const custom = chapter('c1', { kind: 'custom', name: 'Mano' });
    const header = chapter('c2', { kind: 'header', name: 'Event' });
    const label = chapterLabel(LT, names(), [custom, header]);
    expect(label(custom)).toBe('Mano');
    expect(label(header)).toBe('Event');
  });

  it('numbers an untitled chapter through the catalogue', () => {
    const third = chapter('c3', { kind: 'index', number: 3 });
    expect(chapterLabel(LT, names(), [third])(third)).toBe('Skyrius 3');
    expect(chapterLabel(EN, names(), [third])(third)).toBe('Chapter 3');
  });

  it('tells apart two chapters named after the same opening', () => {
    const a = chapter('a', { kind: 'eco', eco: 'D02' });
    const b = chapter('b', { kind: 'eco', eco: 'D02' });
    const label = chapterLabel(
      LT,
      names({
        a: { eco: 'D02', firstMove: move(2, 'Bf4') },
        b: { eco: 'D02', firstMove: move(2, 'Nf3') },
      }),
      [a, b],
    );
    expect(label(a)).toBe('Londono sistema (D02, 2.\u00A0Bf4)');
    expect(label(b)).toBe('Londono sistema (D02, 2.\u00A0Nf3)');
  });

  it('names a chapter outside the list by its plain title', () => {
    const other = chapter('z', { kind: 'custom', name: 'Kita' });
    expect(chapterLabel(LT, names(), [])(other)).toBe('Kita');
  });
});
