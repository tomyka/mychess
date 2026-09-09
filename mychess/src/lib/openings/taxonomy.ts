// mychess/src/lib/openings/taxonomy.ts
//
// The curated opening taxonomy (GitHub issue #201, epic #119) — what a coach
// prepares, as opposed to what ECO catalogues.
//
// Hand-authored on purpose. ECO groups by move order rather than by
// preparation: A00 lumps unrelated irregular openings together, while the
// Sicilian's 80 codes are plausibly ONE prep item for Black and SEVERAL for
// White (Open, Alapin and Closed are different preparation). No derived list
// survives that unedited, so this one is written, not generated.
//
// One entry per (opening, side), because the two sides need different
// granularity and ECO codes already carry the distinction (B22 Alapin vs B90
// Najdorf).
//
// `id` is a stable slug because #202 stores it: renaming a display name must
// not orphan a student's mapping.
//
// `ecoCodes` are explicit rather than ranges — ranges read compactly but hide
// gaps, and ECO decades are not contiguous by theme.
//
// Guarded by taxonomy.test.ts: unique ids, no two same-side entries claiming
// one code, every entry carrying a Lithuanian name.

export type OpeningSide = 'white' | 'black';

export type CuratedOpening = {
  id: string;
  name: string;
  nameLt: string;
  side: OpeningSide;
  ecoCodes: string[];
};

/**
 * A starter set, not the finished taxonomy — the list's contents are the
 * maintainer's to author (see the spec's Non-Goals). These three exercise the
 * case the structure exists for: B22 and B90 both belong to ECO's "Sicilian
 * Defense" family, but White prepares them as two separate things while Black
 * has one Najdorf entry.
 */
export const CURATED_OPENINGS: CuratedOpening[] = [
  {
    id: 'sicilian-najdorf-black',
    name: 'Sicilian: Najdorf',
    nameLt: 'Siciliška: Naidorfo variantas',
    side: 'black',
    ecoCodes: ['B90', 'B91', 'B92', 'B93', 'B94', 'B95', 'B96', 'B97', 'B98', 'B99']
  },
  {
    id: 'anti-sicilian-alapin-white',
    name: 'Anti-Sicilian: Alapin',
    nameLt: 'Prieš siciliškąją: Alapino variantas',
    side: 'white',
    ecoCodes: ['B22']
  },
  {
    id: 'open-sicilian-white',
    name: 'Open Sicilian',
    nameLt: 'Atviroji siciliška',
    side: 'white',
    ecoCodes: ['B90', 'B91', 'B92', 'B93', 'B94', 'B95', 'B96', 'B97', 'B98', 'B99']
  }
];
