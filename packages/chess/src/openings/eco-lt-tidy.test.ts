import { describe, expect, it } from 'vitest';
import { ECO_LT } from './data/eco-lt';
import { isMoveToken, tidyLtName } from './eco-lt-tidy';

// Real šachmatai.lt names (ruling R-77: a safe tidy only; wording,
// capitalisation and word forms stay verbatim).
describe('tidyLtName', () => {
  it('collapses doubled spaces, writes castling with the letter O and adds the missing comma', () => {
    expect(
      tidyLtName('Ispaniškoji partija, Modernioji Šteinico gynyba  5.0-0'),
    ).toBe('Ispaniškoji partija, Modernioji Šteinico gynyba, 5.O-O');
  });

  it('adds the comma before a trailing move qualifier (E06-E08)', () => {
    expect(tidyLtName('Kataloniškas debiutas, Uždaras variantas 5.Žf3')).toBe(
      'Kataloniškas debiutas, Uždaras variantas, 5.Žf3',
    );
    expect(
      tidyLtName('Kataloniškas debiutas, Uždaras variantas 6...Žbd7'),
    ).toBe('Kataloniškas debiutas, Uždaras variantas, 6...Žbd7');
    expect(tidyLtName('Kataloniškas debiutas, Uždaras variantas 7.Vc2')).toBe(
      'Kataloniškas debiutas, Uždaras variantas, 7.Vc2',
    );
  });

  it('drops the space after a move number and fixes queenside and kingside castling (D74)', () => {
    expect(tidyLtName('Neo-Griunfeldo gynyba, 5. Žf3 0-0')).toBe(
      'Neo-Griunfeldo gynyba, 5.Žf3 O-O',
    );
    expect(
      tidyLtName(
        'Siciliška gynyba, Drakono variantas, Jugoslaviška ataka, 10.0-0-0',
      ),
    ).toBe('Siciliška gynyba, Drakono variantas, Jugoslaviška ataka, 10.O-O-O');
  });

  it('tidies every move number of a longer qualifier', () => {
    expect(
      tidyLtName(
        'Nimcovičiaus gynyba, Zemišo variantas, 4. a3 Rc3+ 5. bc3 c5 6. e3',
      ),
    ).toBe('Nimcovičiaus gynyba, Zemišo variantas, 4.a3 Rc3+ 5.bc3 c5 6.e3');
    expect(tidyLtName('Valdovės pėstininko debiutas 3. Žf3')).toBe(
      'Valdovės pėstininko debiutas, 3.Žf3',
    );
  });

  it('trims the ends', () => {
    expect(tidyLtName('  Biordo debiutas \t')).toBe('Biordo debiutas');
  });

  it('leaves a qualifier introduced by su, be or ir alone', () => {
    for (const name of [
      'Klasikinė Benoni gynyba, be 9.O-O',
      'Nimcovičiaus gynyba, 4.e3, Pagrindinis variantas su 8...Rc3',
      'Nimcovičiaus gynyba, 4.e3, Pagrindinis variantas 8...dc4 ir 9...cd4',
    ]) {
      expect(tidyLtName(name)).toBe(name);
    }
  });

  it('leaves names whose moves are not a trailing qualifier alone', () => {
    for (const name of [
      'Siciliška gynyba, Naidorfo variantas, 7...Be7 Pagrindinė linija',
      'Siciliška gynyba 7...Re7 Pagrindinė linija',
      'Angliškas debiutas, Keturių žirgų sistema g3 variantas',
      'Atmestas valdovės gambitas, 4.Rg5 Žbd7',
      'Nimcovičiaus gynyba, 4.e3 c5, 5.Že2',
      'Valdovės pėstininko debiutas',
      '5.Žf3',
    ]) {
      expect(tidyLtName(name)).toBe(name);
    }
  });

  it('does not add a comma after a move that is not numbered', () => {
    expect(tidyLtName('Angliškas debiutas, sistema g3 5.Žf3')).toBe(
      'Angliškas debiutas, sistema g3 5.Žf3',
    );
  });

  it('has been applied to the generated Lithuanian names', () => {
    expect(
      Object.entries(ECO_LT).filter(([, name]) => tidyLtName(name) !== name),
    ).toEqual([]);
  });

  it('is idempotent', () => {
    const once = tidyLtName(
      'Ispaniškoji partija, Modernioji Šteinico gynyba  5.0-0',
    );
    expect(tidyLtName(once)).toBe(once);
  });
});

describe('isMoveToken', () => {
  it('takes moves with and without a number', () => {
    for (const token of [
      'c5',
      'Žbd7',
      'Rc3+',
      'bc3',
      'exd5',
      'B1e2',
      'O-O',
      'O-O-O#',
      '5.Žf3',
      '6...Žbd7',
    ]) {
      expect([token, isMoveToken(token)]).toEqual([token, true]);
    }
  });

  it('takes a short pawn capture between neighbouring files (D44 "dc")', () => {
    expect(isMoveToken('dc')).toBe(true);
    expect(isMoveToken('cd')).toBe(true);
  });

  it('refuses words that only look like squares without a rank', () => {
    for (const token of ['be', 'su', 'ir', 'ah', 'Ž', 'e9', 'c']) {
      expect([token, isMoveToken(token)]).toEqual([token, false]);
    }
  });
});
