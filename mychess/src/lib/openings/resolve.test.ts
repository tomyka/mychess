import { describe, it, expect } from 'vitest';
import { resolveOpening, curatedOpeningName } from './resolve';
import type { CuratedOpening } from './taxonomy';

const TAXONOMY: CuratedOpening[] = [
  { id: 'najdorf-black', name: 'Sicilian: Najdorf', nameLt: 'Naidorfo variantas', side: 'black', ecoCodes: ['B90'] },
  { id: 'open-sicilian-white', name: 'Open Sicilian', nameLt: 'Atviroji siciliška', side: 'white', ecoCodes: ['B90'] },
  { id: 'alapin-white', name: 'Anti-Sicilian: Alapin', nameLt: 'Alapino variantas', side: 'white', ecoCodes: ['B22'] }
];

describe('resolveOpening', () => {
  it('derives from the ECO code and colour when there is no override', () => {
    expect(resolveOpening({ eco_code: 'B22', color: 'white', opening_id: null }, TAXONOMY)?.id).toBe('alapin-white');
  });

  // The whole reason entries are per-side: one code, two sides, two answers.
  it('picks the entry matching the colour when one code serves both sides', () => {
    expect(resolveOpening({ eco_code: 'B90', color: 'black', opening_id: null }, TAXONOMY)?.id).toBe('najdorf-black');
    expect(resolveOpening({ eco_code: 'B90', color: 'white', opening_id: null }, TAXONOMY)?.id).toBe('open-sicilian-white');
  });

  it('lets a stored override win over derivation', () => {
    expect(
      resolveOpening({ eco_code: 'B22', color: 'white', opening_id: 'open-sicilian-white' }, TAXONOMY)?.id
    ).toBe('open-sicilian-white');
  });

  it('returns null for an override naming an entry that no longer exists', () => {
    expect(resolveOpening({ eco_code: 'B22', color: 'white', opening_id: 'deleted-entry' }, TAXONOMY)).toBeNull();
  });

  it('returns null when the repertoire has no ECO code', () => {
    expect(resolveOpening({ eco_code: null, color: 'white', opening_id: null }, TAXONOMY)).toBeNull();
  });

  it('returns null when no entry claims the code for that colour', () => {
    expect(resolveOpening({ eco_code: 'B22', color: 'black', opening_id: null }, TAXONOMY)).toBeNull();
    expect(resolveOpening({ eco_code: 'A00', color: 'white', opening_id: null }, TAXONOMY)).toBeNull();
  });

  it('returns null for an override whose side does not match the repertoire colour', () => {
    expect(
      resolveOpening({ eco_code: 'B90', color: 'white', opening_id: 'najdorf-black' }, TAXONOMY)
    ).toBeNull();
  });

  it('returns null when the repertoire has no colour, even with a valid ECO code', () => {
    expect(resolveOpening({ eco_code: 'B22', color: null, opening_id: null }, TAXONOMY)).toBeNull();
  });

  it('lets a stored override win even when the repertoire has no ECO code', () => {
    expect(
      resolveOpening({ eco_code: null, color: 'white', opening_id: 'open-sicilian-white' }, TAXONOMY)?.id
    ).toBe('open-sicilian-white');
  });
});

describe('curatedOpeningName', () => {
  it('returns the Lithuanian name under the lt locale', () => {
    expect(curatedOpeningName(TAXONOMY[0], 'lt')).toBe('Naidorfo variantas');
  });

  it('returns the English name otherwise', () => {
    expect(curatedOpeningName(TAXONOMY[0], 'en')).toBe('Sicilian: Najdorf');
  });

  it('returns null when there is no opening', () => {
    expect(curatedOpeningName(null, 'lt')).toBeNull();
  });
});
