import { describe, it, expect } from 'vitest';
import { activeByOpening, isActiveRowStale, REPERTOIRE_OPENING_COLUMNS } from './active';
import type { CuratedOpening } from './taxonomy';

const TAXONOMY: CuratedOpening[] = [
  { id: 'najdorf-black', name: 'Sicilian: Najdorf', nameLt: 'Naidorfo variantas', side: 'black', ecoCodes: ['B90'] },
  { id: 'alapin-white', name: 'Anti-Sicilian: Alapin', nameLt: 'Alapino variantas', side: 'white', ecoCodes: ['B22'] }
];

const ALAPIN = { id: 'rep-alapin', eco_code: 'B22', color: 'white' as const, opening_id: null };
const NAJDORF = { id: 'rep-najdorf', eco_code: 'B90', color: 'black' as const, opening_id: null };
const UNCLASSIFIED = { id: 'rep-none', eco_code: 'A00', color: 'white' as const, opening_id: null };

describe('isActiveRowStale', () => {
  it('is false while the repertoire still resolves to the row it was written for', () => {
    expect(isActiveRowStale({ opening_id: 'alapin-white', repertoire_id: 'rep-alapin' }, ALAPIN, TAXONOMY)).toBe(false);
  });

  // The taxonomy is hand-edited and will churn. A row written when this
  // repertoire meant one opening must not keep claiming that opening after an
  // edit moves it — showing the wrong preparation is worse than showing none.
  it('is true once the repertoire resolves somewhere else', () => {
    expect(isActiveRowStale({ opening_id: 'najdorf-black', repertoire_id: 'rep-alapin' }, ALAPIN, TAXONOMY)).toBe(true);
  });

  it('is true when the repertoire resolves to no curated opening at all', () => {
    expect(isActiveRowStale({ opening_id: 'alapin-white', repertoire_id: 'rep-none' }, UNCLASSIFIED, TAXONOMY)).toBe(true);
  });

  // A coach reading a student's rows cannot read a repertoire the student
  // uploaded themselves, so the embed comes back null. Unverifiable is treated
  // as stale rather than trusted.
  it('is true when the repertoire is not readable', () => {
    expect(isActiveRowStale({ opening_id: 'alapin-white', repertoire_id: 'rep-alapin' }, undefined, TAXONOMY)).toBe(true);
  });
});

describe('activeByOpening', () => {
  it('keys the active repertoire by its opening', () => {
    const map = activeByOpening(
      [ALAPIN, NAJDORF],
      [
        { opening_id: 'alapin-white', repertoire_id: 'rep-alapin' },
        { opening_id: 'najdorf-black', repertoire_id: 'rep-najdorf' }
      ],
      TAXONOMY
    );

    expect(map.get('alapin-white')?.id).toBe('rep-alapin');
    expect(map.get('najdorf-black')?.id).toBe('rep-najdorf');
  });

  it('drops a stale row instead of reporting the wrong repertoire', () => {
    const map = activeByOpening([ALAPIN], [{ opening_id: 'najdorf-black', repertoire_id: 'rep-alapin' }], TAXONOMY);

    expect(map.size).toBe(0);
  });

  it('drops a row whose repertoire is missing from the list', () => {
    const map = activeByOpening([ALAPIN], [{ opening_id: 'najdorf-black', repertoire_id: 'rep-gone' }], TAXONOMY);

    expect(map.size).toBe(0);
  });

  // Callers pass their own richer rows (a name, a colour dot) and read them
  // back out of the map, so the generic must not flatten them.
  it('returns the caller’s own objects, not a narrowed copy', () => {
    const map = activeByOpening(
      [{ ...ALAPIN, name: 'My Alapin' }],
      [{ opening_id: 'alapin-white', repertoire_id: 'rep-alapin' }],
      TAXONOMY
    );

    expect(map.get('alapin-white')?.name).toBe('My Alapin');
  });
});

describe('REPERTOIRE_OPENING_COLUMNS', () => {
  // The silent failure this guards: drop eco_code from a select and every
  // opening resolves to null, so the whole control vanishes with no error.
  it('names every column resolveOpening reads', () => {
    expect(REPERTOIRE_OPENING_COLUMNS.split(', ').sort()).toEqual(['color', 'eco_code', 'id', 'opening_id']);
  });
});
