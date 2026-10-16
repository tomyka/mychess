import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { ECO } from './data/eco';
import { ECO_LT } from './data/eco-lt';

describe('ECO table', () => {
  it('has one entry for every code from A00 to E99, in order', () => {
    const codes = ['A', 'B', 'C', 'D', 'E'].flatMap((volume) =>
      Array.from(
        { length: 100 },
        (_, n) => `${volume}${String(n).padStart(2, '0')}`,
      ),
    );
    expect(ECO.map((entry) => entry.code)).toEqual(codes);
  });

  it('gives every entry an English name and a line legal from the start', () => {
    const broken = ECO.filter((entry) => {
      const game = new Chess();
      try {
        entry.moves.forEach((san) => game.move(san));
      } catch {
        return true;
      }
      return entry.name.trim() === '' || entry.moves.length === 0;
    }).map((entry) => entry.code);
    expect(broken).toEqual([]);
  });

  it('keeps known entries', () => {
    expect(ECO.find((entry) => entry.code === 'B90')).toEqual({
      code: 'B90',
      name: 'Sicilian Defense: Najdorf Variation',
      moves: [
        'e4',
        'c5',
        'Nf3',
        'd6',
        'd4',
        'cxd4',
        'Nxd4',
        'Nf6',
        'Nc3',
        'a6',
      ],
    });
  });
});

describe('Lithuanian ECO coverage', () => {
  it('names every code that the English data carries', () => {
    const missing = ECO.map((entry) => entry.code).filter(
      (code) => !(code in ECO_LT),
    );
    // A non-empty list means the English generator introduced codes that the
    // Lithuanian generator has not been re-run for. Those codes fall back to
    // English rather than rendering blank, so this is a prompt to regenerate,
    // not an outage.
    expect(missing).toEqual([]);
  });

  it('carries no Lithuanian name for a code the English data does not have', () => {
    const codes = new Set(ECO.map((entry) => entry.code));
    expect(Object.keys(ECO_LT).filter((code) => !codes.has(code))).toEqual([]);
  });

  it('has no blank names', () => {
    expect(
      Object.entries(ECO_LT).filter(([, name]) => name.trim() === ''),
    ).toEqual([]);
  });

  it('keeps known names', () => {
    expect(ECO_LT['A00']).toBe('Nepopuliarūs debiutai');
    expect(ECO_LT['E99']).toBe(
      'Karaliaus Indiška gynyba, Ortodoksinis variantas, Pagrindinis Aronino-Taimanovo variantas',
    );
  });
});
