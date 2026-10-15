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
// WHEN A MOVE-ORDER VARIANT EARNS ITS OWN ENTRY (settled in #216, because the
// question recurs for every family this list grows into): give it one when
// ECO already files it separately AND a coach would prepare the move order
// itself, not merely arrive at the same position. The Alapin (B22, 2.c3) and
// the Delayed Alapin (B50, 2.Nf3 d6 3.c3) are two entries by that test — same
// structures, different thing to learn. A transposition that ECO files under
// the SAME code is never its own entry; it is the same preparation reached
// another way.
//
// Guarded by taxonomy.test.ts: unique ids, no two same-side entries claiming
// one code, every entry carrying a Lithuanian name, every entry carrying at
// least one code, side restricted to white/black, and every code existing in
// the real ECO table (eco-data.ts) — that last check lives in the test file
// only, so this module itself stays free of any import from eco-data.

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
    // Its own entry rather than another code on the Alapin above, per the
    // move-order rule in this file's header: 2.Nf3 d6 3.c3 is reached by a
    // different move order, is filed under its own ECO code, and a coach
    // preparing it is preparing the delay itself. Only B50 — the neighbouring
    // codes are other systems entirely (B51/B52 Moscow, B54-B59 Classical),
    // and claiming them would label those repertoires as this.
    id: 'anti-sicilian-delayed-alapin-white',
    name: 'Anti-Sicilian: Delayed Alapin',
    nameLt: 'Prieš siciliškąją: atidėtas Alapino variantas',
    side: 'white',
    ecoCodes: ['B50']
  },
  {
    id: 'open-sicilian-white',
    name: 'Open Sicilian',
    nameLt: 'Atviroji siciliška',
    side: 'white',
    ecoCodes: ['B90', 'B91', 'B92', 'B93', 'B94', 'B95', 'B96', 'B97', 'B98', 'B99']
  }
];
