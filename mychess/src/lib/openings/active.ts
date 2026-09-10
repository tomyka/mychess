// mychess/src/lib/openings/active.ts
//
// Which repertoire is a student's current preparation for an opening (GitHub
// issue #202, part B of epic #119). Pure — the Supabase side is
// src/lib/server/active-openings.ts.
import { resolveOpening } from './resolve';
import { CURATED_OPENINGS, type CuratedOpening, type OpeningSide } from './taxonomy';

/** One row of `active_opening_repertoires`, as far as this layer cares. */
export type ActiveOpeningRow = { opening_id: string; repertoire_id: string };

/** The repertoire columns `resolveOpening` reads, plus the id to match rows on. */
export type ResolvableRepertoire = {
  id: string;
  eco_code: string | null;
  color: OpeningSide | null;
  opening_id: string | null;
};

// Derived from the type rather than typed out beside it: adding a field to
// ResolvableRepertoire without adding it here is a compile error, so a select
// can never silently omit a column resolveOpening needs.
const REQUIRED_COLUMNS: Record<keyof ResolvableRepertoire, true> = {
  id: true,
  eco_code: true,
  color: true,
  opening_id: true
};

/** PostgREST select list for a repertoire this layer must resolve. */
export const REPERTOIRE_OPENING_COLUMNS = Object.keys(REQUIRED_COLUMNS).join(', ');

/**
 * Has this stored choice stopped matching its repertoire?
 *
 * The taxonomy is hand-edited, so a row written when repertoire R resolved to
 * one opening keeps naming that opening after an edit moves R elsewhere. A
 * stale row is ignored at read time and NOT deleted — same rule part A applies
 * to an override naming a since-deleted entry, and a reverted taxonomy edit
 * then simply works again instead of having destroyed data on the way through.
 *
 * An unreadable repertoire (`undefined`) counts as stale: a coach cannot read a
 * repertoire their student uploaded, so the embed comes back null, and
 * unverifiable must not read as confirmed.
 */
export function isActiveRowStale(
  row: ActiveOpeningRow,
  repertoire: ResolvableRepertoire | undefined,
  taxonomy: CuratedOpening[] = CURATED_OPENINGS
): boolean {
  if (!repertoire) return true;
  return resolveOpening(repertoire, taxonomy)?.id !== row.opening_id;
}

/**
 * What to do with a repertoire's active mappings once it has been reclassified
 * (GitHub issue #210).
 *
 * Reclassifying is a correction to what a repertoire *is*, and says nothing
 * about whose current preparation it is — so a mapping follows its repertoire
 * to the new opening rather than being dropped. Where the repertoire now
 * resolves to no curated opening there is nothing to follow to, and the row is
 * removed rather than left behind pointing at an opening this repertoire no
 * longer prepares.
 *
 * A row already naming the destination is left alone, so a no-op edit writes
 * nothing.
 */
export function planActiveOpeningRepoint(
  rows: ActiveOpeningRow[],
  newOpeningId: string | null
): { repoint: ActiveOpeningRow[]; remove: ActiveOpeningRow[] } {
  if (newOpeningId === null) return { repoint: [], remove: rows };
  return {
    repoint: rows.filter((row) => row.opening_id !== newOpeningId),
    remove: []
  };
}

/**
 * Which curated openings a student has current preparation for, and which they
 * do not (GitHub issue #203).
 *
 * The gap list is the whole point of the coverage report, and it cannot be a
 * SQL query: `repertoires.opening_id` is null on almost every row because the
 * opening is derived, so a database report would count nearly every prepared
 * opening as a gap. It is derived here instead, from resolved answers.
 *
 * Ordered by side then by name so the report reads the way a coach thinks
 * about it — what this student plays as White, then as Black.
 */
export function splitOpeningCoverage(
  preparedOpeningIds: Iterable<string>,
  taxonomy: CuratedOpening[] = CURATED_OPENINGS
): { covered: CuratedOpening[]; gaps: CuratedOpening[] } {
  const prepared = new Set(preparedOpeningIds);
  const ordered = [...taxonomy].sort(
    (a, b) => a.side.localeCompare(b.side) || a.name.localeCompare(b.name)
  );
  return {
    covered: ordered.filter((opening) => prepared.has(opening.id)),
    gaps: ordered.filter((opening) => !prepared.has(opening.id))
  };
}

/** The student's active repertoire per opening, stale rows dropped. */
export function activeByOpening<T extends ResolvableRepertoire>(
  repertoires: T[],
  rows: ActiveOpeningRow[],
  taxonomy: CuratedOpening[] = CURATED_OPENINGS
): Map<string, T> {
  const byId = new Map(repertoires.map((repertoire) => [repertoire.id, repertoire]));
  const active = new Map<string, T>();
  for (const row of rows) {
    const repertoire = byId.get(row.repertoire_id);
    if (!repertoire || isActiveRowStale(row, repertoire, taxonomy)) continue;
    active.set(row.opening_id, repertoire);
  }
  return active;
}
