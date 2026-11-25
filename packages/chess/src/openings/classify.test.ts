import { describe, expect, it } from 'vitest';
import { positionKey } from '../position-key';
import {
  chapterName,
  classify,
  classifyKeys,
  ecoName,
  indexByPosition,
  openingName,
} from './classify';
import { withPositionKeys } from './eco-tsv';

/** The key of the position `sans` reaches from the start. */
const keyAfter = (sans: string[]): string =>
  withPositionKeys([{ code: 'X', name: 'X', moves: sans }], positionKey)[0]
    ?.key ?? '';

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

  it('ignores a repetition back into a shallower opening', () => {
    // 1.Nf3 Nf6 is A05; 2.Ng1 Ng8 3.Nf3 returns to 1.Nf3 (A04), already reached.
    expect(classify(['Nf3'])?.code).toBe('A04');
    expect(classify(['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3'])?.code).toBe('A05');
  });

  it('takes a later match with fewer moves after a lost tempo', () => {
    // 1.Nf3 Nf6 (A05) 2.Ng1 Ng8 3.e4 reaches 1.e4 (B00, one move) further on.
    expect(classify(['Nf3', 'Nf6'])?.code).toBe('A05');
    expect(classify(['Nf3', 'Nf6', 'Ng1', 'Ng8', 'e4'])?.code).toBe('B00');
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
  it('indexes each line by its stored key, the later entry winning', () => {
    const key = keyAfter(['d4', 'd5', 'Nf3']);
    const index = indexByPosition([
      { code: 'X01', name: 'First', moves: ['Nf3', 'd5', 'd4'], key },
      { code: 'X02', name: 'Second', moves: ['d4', 'd5', 'Nf3'], key },
    ]);
    expect([...index.entries()].map(([k, e]) => [k, e.code])).toEqual([
      [key, 'X02'],
    ]);
  });
});

describe('classify over every named line (R-216, #326)', () => {
  it('names the Open Catalan reached by the closed move order', () => {
    const line = [
      'd4',
      'Nf6',
      'c4',
      'e6',
      'g3',
      'd5',
      'Bg2',
      'Be7',
      'Nf3',
      'O-O',
      'O-O',
      'dxc4',
    ];
    expect(classify(line)).toMatchObject({
      code: 'E05',
      name: 'Catalan Opening: Open Defense, Classical Line',
    });
  });

  it('names the Caro-Kann Advance', () => {
    expect(classify(['e4', 'c6', 'd4', 'd5', 'e5'])).toMatchObject({
      code: 'B12',
      name: 'Caro-Kann Defense: Advance Variation',
    });
  });

  it('names the Smith-Morra Gambit', () => {
    expect(classify(['e4', 'c5', 'd4', 'cxd4', 'c3'])).toMatchObject({
      code: 'B21',
      name: 'Sicilian Defense: Smith-Morra Gambit',
    });
  });

  it('keeps the Moscow Variation', () => {
    expect(classify(['e4', 'c5', 'Nf3', 'd6', 'Bb5+'])?.name).toBe(
      'Sicilian Defense: Moscow Variation',
    );
  });
});

describe('classifyKeys', () => {
  it('takes the deepest named key, ignoring a key already passed', () => {
    const nf3 = keyAfter(['Nf3']);
    const nf3nf6 = keyAfter(['Nf3', 'Nf6']);
    expect(classifyKeys([nf3, nf3nf6, 'none', nf3])?.code).toBe('A05');
    expect(classifyKeys([nf3])?.code).toBe('A04');
  });

  it('is null when no key is a named position', () => {
    expect(classifyKeys([])).toBeNull();
    expect(classifyKeys(['none'])).toBeNull();
  });
});

describe('openingName', () => {
  it('is the line name in English and its code name in Lithuanian', () => {
    const entry = classify(['e4', 'c6', 'd4', 'd5', 'e5']);
    expect(entry && openingName(entry, 'en')).toBe(
      'Caro-Kann Defense: Advance Variation',
    );
    expect(entry && openingName(entry, 'lt')).toBe(ecoName('B12', 'lt'));
    expect(ecoName('B12', 'lt')).not.toBe(ecoName('B12', 'en'));
  });

  it('falls back to English for a code without a Lithuanian name', () => {
    const entry = { code: 'Z99', name: 'Nowhere', moves: [], key: 'k' };
    expect(openingName(entry, 'lt')).toBe('Nowhere');
  });
});
