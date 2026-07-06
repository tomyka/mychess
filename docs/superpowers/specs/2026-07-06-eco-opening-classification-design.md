# ECO Opening Classification — Design

## Purpose

Repertoires currently have only a free-text `name` and a `color`. Coaches and players want repertoires tagged with a standard opening classification (ECO code + name) for:

- **Better labeling** — a repertoire card can show "B90 — Sicilian Defense: Najdorf Variation" instead of relying on whatever the coach typed.
- **Filtering/search** — coaches and players can eventually filter their repertoire list by opening.
- **Standardization** — avoids inconsistent free-text opening names ("Sicilian", "sicilian def.", "Sicilian Defense").

## Data source

[`lichess-org/chess-openings`](https://github.com/lichess-org/chess-openings) (CC0 license, no attribution required) — the dataset backing Lichess's own opening explorer. Five TSV files (`a.tsv`–`e.tsv`, one per ECO volume), ~3,700 entries total, each row: `eco` code, `name`, `pgn` (the move sequence that reaches it).

365chess.com's `/eco.php` (the page originally suggested as a reference) returns HTTP 403 to automated fetches and isn't a viable source.

## Granularity: main lines only

The full dataset is too granular for a picker (e.g. distinct entries for "Najdorf Variation, English Attack, 7...b5"). We use **one entry per unique ECO code** (~500–600 entries, A00–E99), keeping the **shortest move sequence** for each code as its canonical name. Verified against the live dataset: for a given code, entries are grouped together with the base/family name naturally being the shortest `pgn` value (e.g. for `B90`, the shortest entry is exactly "Sicilian Defense: Najdorf Variation", with "...Adams Attack", "...English Attack", etc. all longer sequences under the same code).

## Storage: bundled static module, not a DB table

ECO is a fixed historical classification — it doesn't change over time the way FIDE ratings do, so it doesn't need a live table + cron import (unlike `fide_players`). Instead:

- A one-off script (same shape as `scripts/import-fide.ts`) fetches the 5 TSVs, dedupes to the main-line list described above, and writes the result to a generated, checked-in module: `src/lib/openings/eco-data.ts`, exporting `ECO_OPENINGS: { code: string; name: string; moves: string[] }[]`.
- No migration, no seeding, no cron. Re-running the script and re-committing the file is how the list would ever be updated (not expected to happen often, if ever).

## Detection & search (`src/lib/openings/classify.ts`)

Pure, unit-tested module with two functions:

- **`detectOpening(sanMoves: string[]): { code: string; name: string } | null`** — walks `ECO_OPENINGS` and returns the entry whose `moves` array is the **longest** exact prefix-match of the given SAN move list. Both sides are normalized by stripping trailing `+`/`#` before comparing (check/mate annotations shouldn't affect matching). Returns `null` if no entry matches (e.g. an irregular first move).
- **`searchOpenings(query: string): { code: string; name: string }[]`** — case-insensitive substring match against `code` and `name`, for the picker's search box. No fuzzy-matching library needed at ~500 entries.

## Schema change

Two new nullable columns on `repertoires`:

```sql
alter table public.repertoires
  add column eco_code text,
  add column eco_name text;
```

Storing both the code and the resolved name (rather than just the code, looked up at render time) means existing repertoires keep their labels intact even if the bundled list is ever regenerated/changed later.

## Upload flow integration

- `planImport` (`src/lib/pgn-import.ts`, pure) runs `detectOpening` against the **first game's** move list and includes `ecoCode`/`ecoName` (nullable) in its returned plan.
- `importPgn` (`src/lib/server/pgn-import.ts`) writes `eco_code`/`eco_name` onto the new `repertoires` row from the plan.
- On both upload forms (`/coach/pgn` and `/repertoires/new`): after import, the detected opening (or "Unclassified" if detection found nothing) is shown with a "change" control that opens a searchable picker (`searchOpenings`) to override it. Detection never blocks submission — a repertoire with no match still saves as "Unclassified".

## Editing after creation

A "change opening" control on each repertoire row in `/coach/repertoires` and `/(player)/repertoires` opens the same picker component and submits to a new `updateOpening` form action on each page (mirroring each page's existing ownership/auth checks), which updates `eco_code`/`eco_name` on that repertoire. Verified against the live RLS policies: `repertoires_player_all` (`for all using (player_id = auth.uid())`) already covers `UPDATE` for the repertoire's owner — no new migration policy is needed for this, only the `alter table` above.

## Shared picker component

A single `<OpeningPicker>` Svelte component (search input + result list, using `searchOpenings` client-side against a small bundled list passed as data) is reused across both upload pages and both "change opening" affordances — four call sites, one component.

## Out of scope

- Actual filter-by-opening UI on the repertoire list pages (this spec only lands the data; filtering is a follow-up if wanted).
- Auto-detection based on board position/FEN transpositions — matching is by exact SAN move-sequence prefix only, not transposition-aware. Good enough for repertoires that start from a standard move order, which is the normal case.
- Any change to the ~500-entry granularity later (e.g. supporting sub-variations) is a separate future decision.

## Testing

- `classify.ts` (`detectOpening`, `searchOpenings`): full unit tests, following this codebase's pure-logic convention.
- `eco-data.ts` generation script: not unit-tested, matching the `fide/download.ts` precedent (an I/O/build step run once, output reviewed by hand rather than tested).
- `pgn-import.ts` (`planImport`): existing test file gets new cases covering the `ecoCode`/`ecoName` fields.
- Server-side wiring (`server/pgn-import.ts`, the new `updateOpening` actions): not directly unit-tested, matching the established split between pure logic and thin Supabase I/O wrappers elsewhere in the codebase.
