import { describe, expect, it } from 'vitest';
import { chapterName, classify, ecoName, indexByPosition } from './classify';

describe('classify', () => {
  it('finds the deepest ECO match along the line', () => {
    const najdorf = ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6'];
    expect(classify([...najdorf, 'Nc3', 'a6'])?.code).toBe('B90');
  });

  it('keeps the last match when the line goes on past the table', () => {
    expect(classify(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'h6', 'h3'])?.code).toBe(
      'C50',
    );
  });

  it('recognises a transposition by position', () => {
    // Queen's Gambit Declined reached via 1.Nf3: the table's D37 line is
    // 1.d4 Nf6 2.c4 e6 3.Nf3 d5 4.Nc3.
    const viaNf3 = ['Nf3', 'd5', 'd4', 'Nf6', 'c4', 'e6', 'Nc3'];
    expect(classify(viaNf3)?.code).toBe('D37');
    // The QGD itself (D30: 1.d4 d5 2.c4 e6) reached via the English.
    expect(classify(['c4', 'e6', 'd4', 'd5'])?.code).toBe('D30');
  });

  it('returns null for a line no entry matches', () => {
    expect(classify([])).toBeNull();
  });

  it('stops at an illegal move and keeps what it found before', () => {
    expect(classify(['e4', 'c5', 'Ke3'])?.code).toBe('B20');
    expect(classify(['Ke2'])).toBeNull();
  });
});

describe('ecoName', () => {
  it('names a code in English or Lithuanian', () => {
    expect(ecoName('B90', 'en')).toBe('Sicilian Defense: Najdorf Variation');
    expect(ecoName('B90', 'lt')).toBe('Siciliška gynyba, Naidorfo variantas');
  });

  it('falls back to the code for a code it does not know', () => {
    expect(ecoName('Z99', 'lt')).toBe('Z99');
  });
});

describe('chapter names', () => {
  it('prefers a custom name', () => {
    expect(chapterName({ kind: 'custom', name: 'Mano' }, 'lt')).toEqual({
      kind: 'text',
      text: 'Mano',
    });
  });

  it('uses the ECO name in the locale', () => {
    expect(chapterName({ kind: 'eco', eco: 'B90' }, 'en')).toEqual({
      kind: 'text',
      text: ecoName('B90', 'en'),
    });
    expect(chapterName({ kind: 'eco', eco: 'B90' }, 'lt')).toEqual({
      kind: 'text',
      text: ecoName('B90', 'lt'),
    });
    expect(ecoName('B90', 'lt')).not.toBe(ecoName('B90', 'en'));
  });

  it('falls back to the header name, then a numbered key', () => {
    expect(chapterName({ kind: 'header', name: 'Italian' }, 'lt')).toEqual({
      kind: 'text',
      text: 'Italian',
    });
    expect(chapterName({ kind: 'index', number: 3 }, 'lt')).toEqual({
      kind: 'key',
      key: 'chapter.untitled',
      number: 3,
    });
  });
});

describe('indexByPosition', () => {
  it('indexes each line by its final position, the later entry winning', () => {
    const index = indexByPosition([
      { code: 'X01', name: 'First', moves: ['Nf3', 'd5', 'd4'] },
      { code: 'X02', name: 'Second', moves: ['d4', 'd5', 'Nf3'] },
    ]);
    expect([...index.values()].map((e) => e.code)).toEqual(['X02']);
  });

  it('throws at an illegal move: the ECO data is broken', () => {
    expect(() =>
      indexByPosition([{ code: 'X99', name: 'Bad', moves: ['e4', 'Ke3'] }]),
    ).toThrow('ECO X99: illegal move Ke3');
  });
});
