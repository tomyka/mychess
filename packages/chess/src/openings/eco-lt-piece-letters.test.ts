import { describe, expect, it } from 'vitest';
import { ECO } from './data/eco';
import { ECO_LT } from './data/eco-lt';
import {
  correctPieceLetters,
  PIECE_LETTER_CORRECTIONS,
} from './eco-lt-piece-letters';

// Ruling R-161: English piece letters in šachmatai.lt's names are corrected
// only through the explicit per-code list, never by a blanket letter swap.
const LT_TO_SAN: Readonly<Record<string, string>> = {
  K: 'K',
  V: 'Q',
  B: 'R',
  R: 'B',
  Ž: 'N',
};

/** `12...Žc6` -> the ply index (23) and the SAN in English letters (Nc6). */
function asSan(move: string): { ply: number; san: string } {
  const [, number = '', dots = '', piece = '', rest = ''] =
    /^(\d+)(\.+)(\D)(.+)$/u.exec(move) ?? [];
  const san = (LT_TO_SAN[piece] ?? piece) + rest;
  return { ply: (Number(number) - 1) * 2 + (dots === '.' ? 0 : 1), san };
}

function ecoMoves(code: string): readonly string[] {
  return ECO.find((entry) => entry.code === code)?.moves ?? [];
}

describe('correctPieceLetters', () => {
  it('corrects the listed English letters to Lithuanian ones', () => {
    expect(
      correctPieceLetters('D95', 'Griunfeldo gynyba, 5.e3 O-O 6.Qb3'),
    ).toBe('Griunfeldo gynyba, 5.e3 O-O 6.Vb3');
    expect(
      correctPieceLetters(
        'C98',
        'Ispaniškoji partija, Uždarasis variantas, Čigorino gynyba, 12...Nc6',
      ),
    ).toBe(
      'Ispaniškoji partija, Uždarasis variantas, Čigorino gynyba, 12...Žc6',
    );
    expect(
      correctPieceLetters('E48', 'Nimcovičiaus gynyba, 4.e3 O-O, 5.Bd3 d5'),
    ).toBe('Nimcovičiaus gynyba, 4.e3 O-O, 5.Rd3 d5');
    expect(
      correctPieceLetters(
        'B99',
        'Siciliška gynyba, Naidorfo variantas, 7...Be7 Pagrindinė linija',
      ),
    ).toBe('Siciliška gynyba, Naidorfo variantas, 7...Re7 Pagrindinė linija');
  });

  it('is not a blanket swap: the same letters elsewhere stay', () => {
    // D63 7.Bc1 is the rook (B is bokštas); A76 9...Be8 is the rook too.
    expect(
      correctPieceLetters(
        'D63',
        'Atmestas valdovės gambitas, Ortodoksinė gynyba, 7.Bc1',
      ),
    ).toBe('Atmestas valdovės gambitas, Ortodoksinė gynyba, 7.Bc1');
    expect(correctPieceLetters('A76', 'Klasikinė Benoni gynyba, 9...Be8')).toBe(
      'Klasikinė Benoni gynyba, 9...Be8',
    );
    // D95's listed text under another code stays.
    expect(correctPieceLetters('D94', 'Griunfeldo gynyba, 6.Qb3')).toBe(
      'Griunfeldo gynyba, 6.Qb3',
    );
  });

  it('leaves a name already corrected at the source unchanged', () => {
    expect(
      correctPieceLetters('D95', 'Griunfeldo gynyba, 5.e3 O-O 6.Vb3'),
    ).toBe('Griunfeldo gynyba, 5.e3 O-O 6.Vb3');
  });

  it('only corrects to the piece the ECO line actually moves', () => {
    for (const [code, corrections] of Object.entries(
      PIECE_LETTER_CORRECTIONS,
    )) {
      for (const { wrong, right } of corrections) {
        const { ply, san } = asSan(right);
        expect([code, wrong, ecoMoves(code)[ply]]).toEqual([code, wrong, san]);
      }
    }
  });

  it('keeps D63 7.Bc1: the line moves the rook, which is B in Lithuanian', () => {
    const { ply, san } = asSan('7.Bc1');
    expect(ecoMoves('D63')[ply]).toBe(san);
  });

  it('has been applied to the generated Lithuanian names', () => {
    for (const [code, corrections] of Object.entries(
      PIECE_LETTER_CORRECTIONS,
    )) {
      for (const { wrong, right } of corrections) {
        expect([code, ECO_LT[code]?.includes(right)]).toEqual([code, true]);
        expect([code, ECO_LT[code]?.includes(wrong)]).toEqual([code, false]);
      }
    }
  });

  it('leaves no English queen or knight letter in a move of any name', () => {
    expect(
      Object.entries(ECO_LT).filter(([, name]) =>
        /(?:^|[\s.])[QN][a-h]?[1-8]?x?[a-h][1-8]/u.test(name),
      ),
    ).toEqual([]);
  });
});
