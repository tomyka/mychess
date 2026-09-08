import { describe, it, expect } from 'vitest';
import { localizedOpeningName } from './name';

const NAMES_LT = { B90: 'Siciliška gynyba, Naidorfo variantas' };

describe('localizedOpeningName', () => {
  it('returns the Lithuanian name under the lt locale', () => {
    expect(
      localizedOpeningName({
        code: 'B90',
        englishName: 'Sicilian Defense: Najdorf Variation',
        locale: 'lt',
        namesLt: NAMES_LT
      })
    ).toBe('Siciliška gynyba, Naidorfo variantas');
  });

  it('returns the English name under any other locale', () => {
    expect(
      localizedOpeningName({
        code: 'B90',
        englishName: 'Sicilian Defense: Najdorf Variation',
        locale: 'en',
        namesLt: NAMES_LT
      })
    ).toBe('Sicilian Defense: Najdorf Variation');
  });

  it('falls back to English when lt has no entry for the code', () => {
    expect(
      localizedOpeningName({
        code: 'Z99',
        englishName: 'Some Future Opening',
        locale: 'lt',
        namesLt: NAMES_LT
      })
    ).toBe('Some Future Opening');
  });

  it('returns null when there is no code', () => {
    expect(localizedOpeningName({ code: null, englishName: null, locale: 'lt', namesLt: NAMES_LT })).toBeNull();
  });

  it('returns the Lithuanian name even when no English name was stored', () => {
    expect(localizedOpeningName({ code: 'B90', englishName: null, locale: 'lt', namesLt: NAMES_LT })).toBe(
      'Siciliška gynyba, Naidorfo variantas'
    );
  });
});
