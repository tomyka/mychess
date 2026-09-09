# Opening taxonomy + auto-detection at import

GitHub issue #201 — part A of epic #119, which was split into three
(#201/#202/#203) because taxonomy, mapping semantics and prep UI each ship
independently and verify differently.

## Problem

A repertoire is identified only by the filename its coach gave it.
`Atidetas Alapinas baltais 2025 (1)` tells a student nothing about which opening
it prepares, so nobody can answer "what do I play as Black against 1.e4
tomorrow?" without knowing the files.

`repertoires.eco_code`/`eco_name` exist (migration 0022) but do not solve it:
ECO has 500 codes, groups by move-order accident rather than by what a coach
prepares, and carries no notion of which side you are preparing from.

## What already exists, and shapes the design

- **`repertoires.color`** (`'white' | 'black'`) already records which side a
  repertoire is for.
- **`repertoires.eco_code`** is already set at import — `pgn-import.ts` runs
  `detectOpening(sanMoves, ECO_OPENINGS)`.
- **`detectOpening`** takes its table as an argument, the pattern this design
  follows for its own resolver.
- **`updateOpening`** in `(coach)/coach/repertoires/+page.server.ts` already
  lets the owner set `eco_code`/`eco_name` from `OpeningPicker.svelte`.
- **#158** established that opening names live in data modules rather than
  Paraglide message files.

## Design

### The taxonomy is a hand-authored TypeScript module

`src/lib/openings/taxonomy.ts`:

```ts
export type OpeningSide = 'white' | 'black';
export type CuratedOpening = {
  id: string;          // stable slug, e.g. 'sicilian-najdorf-black'
  name: string;        // English display name
  nameLt: string;      // Lithuanian display name
  side: OpeningSide;
  ecoCodes: string[];  // explicit codes, not ranges
};
export const CURATED_OPENINGS: CuratedOpening[] = [ /* authored by the maintainer */ ];
```

**The list's contents are a teaching decision and are authored by the
maintainer, not derived.** Three candidate sources were weighed — the 54 English
ECO families in `eco-data.ts`, the 50 Lithuanian decade groups from #158's
source, and a hand-written list. The derived options were rejected because ECO
groups by move order rather than by preparation: `A00` lumps unrelated irregular
openings together, while `Sicilian Defense`'s 80 codes are plausibly one prep
item for Black and several distinct ones for White (Open, Alapin and Closed are
different preparation). Neither derived list survives that unedited.

**Why a code module rather than a database table.** The list will churn while it
is being refined, and this project has no linked Supabase CLI — every migration
is a manual dashboard paste (the friction that stalled #184's Task 6). A table
would mean one such paste per revision. The module is authored as a file, in
git, reviewed in a PR, guarded by tests.

**Why one entry per (opening, side).** It lets White's and Black's taxonomies
differ in granularity, which they genuinely do. ECO codes already distinguish
the White-side splits (`B22` Alapin vs `B90` Najdorf), so the code sets carry
the distinction.

**Why `id` is a slug, not a display name.** Part B (#202) stores it, so renaming
a display name must not orphan mappings.

**Why explicit codes rather than ranges.** Ranges read compactly but hide gaps,
and ECO decades are not contiguous by theme.

### Resolution: derive, with a stored override

One migration, one column: `repertoires.opening_id text null`. It holds *only* a
coach's explicit correction.

`src/lib/openings/resolve.ts`:

```ts
resolveOpening(
  repertoire: { eco_code: string | null; color: OpeningSide; opening_id: string | null },
  taxonomy?: CuratedOpening[]
): CuratedOpening | null
```

| `opening_id` | behaviour |
| --- | --- |
| set | that entry — the coach said so |
| null | the entry whose `ecoCodes` include `eco_code` **and** whose `side` matches `color` |
| null, no match or no `eco_code` | `null`; callers fall back (see cascade below) |

Pure, taxonomy injected with a default, mirroring `detectOpening`.

**Why derive rather than store at import.** A repertoire detected against last
week's list would keep last week's answer forever, and each list revision would
need a data migration to catch up. Under derivation, editing the taxonomy
retroactively fixes every repertoire; the override covers the exceptions, which
is the only part that should be sticky.

**The hazard this creates, and the guard.** Because almost every row's
`opening_id` is null, any call site reading the column directly sees nothing and
renders blank. `resolveOpening` is therefore the only accessor, and a test
asserts the null-column case *derives* rather than returning null. The failure
mode is silent, so it is a test rather than a comment.

### Detection needs no import change

The opening derives from `eco_code`, which import already sets. #201's "import
auto-suggests an opening" is satisfied by `resolveOpening` with no changes to
`pgn-import.ts` or `api/repertoires/import-chapter`.

### Correction, and the two-paths problem

`updateOpening` already changes the derived opening as a side effect of setting
`eco_code`. Two ways to answer one question is how a coach ends up fixing an ECO
code to move a file between prep categories and being surprised later. So the
two are given distinct jobs:

- **The ECO picker keeps its current job** — classifying the repertoire's ECO
  code. Unchanged.
- **The opening override answers a different question** — which prep item this
  file is for — and wins whenever set.

New UI on the coach repertoire list, beside the existing "Change" link:
**`src/lib/components/CuratedOpeningPicker.svelte`**, a new component rather
than a change to `OpeningPicker.svelte` — that one searches 500 ECO entries and
posts `eco_code`/`eco_name`, this one lists a few dozen and posts `opening_id`.
Sharing them would mean one component serving two different questions, which is
the confusion this section exists to prevent.

It lists `CURATED_OPENINGS` **filtered to the repertoire's own `color`**, so a
white file offers only white-side entries, plus an "Auto" choice that posts an
empty `opening_id` and clears the override back to derivation — the same
empty-value convention `OpeningPicker` already uses for "Unclassified".

If the taxonomy has no entries for that colour yet, the picker shows only
"Auto". That is the expected state early on and needs no special copy beyond
the existing no-matches message.

A new `updateRepertoireOpening` action mirrors `updateOpening`'s shape,
including its `player_id = user!.id` scoping.

### Display cascade

In both `(player)/repertoires/+page.svelte` and
`(coach)/coach/repertoires/+page.svelte`:

```
resolved opening        → its localised name
else eco_code present   → "{code} — {localised eco name}", exactly as today
else                    → filename only, as today
```

The opening name replaces the ECO line rather than joining it: a student asking
"what do I play as Black against 1.e4" is served by `Sicilian: Najdorf`, and
`B90 — Siciliška gynyba, Naidorfo variantas` beside it is noise. The ECO line
remains the fallback, so nothing regresses for repertoires the taxonomy does not
cover — which, while the list is short, will be most of them.

### Lithuanian names

`nameLt` on the entry, resolved by a small `curatedOpeningName(entry, locale)`
helper. Follows #158's precedent that opening names are data, not UI copy.

Paraglide was considered and rejected: its keys must be static identifiers kept
in sync with slugs (`opening_sicilian_najdorf_black` ↔
`sicilian-najdorf-black`), which needs a drift test anyway — the same guard with
more moving parts. Authoring both names on one row also keeps one row per
opening.

**The cost, stated plainly:** Lithuanian copy now lives in two places, so "is
everything translated" is no longer answerable from `lt.json` alone. The
`nameLt` guard test below replaces that audit.

## Testing

| test | what it catches |
| --- | --- |
| ECO codes disjoint per side | two entries claiming `B22`/`white`, which makes resolution silently order-dependent |
| `id` values unique | part B stores them as text with no foreign key |
| every entry has a non-empty `nameLt` | the translation gap the Paraglide decision costs |
| override wins over derivation | the override taking effect at all |
| null `opening_id` derives from `(eco_code, color)` | the silent-blank hazard above |
| null when no code, or no matching entry | the ECO-line fallback |
| `curatedOpeningName` returns `nameLt` under `lt` and `name` otherwise | the locale switch on the curated names, mirroring #158's `localizedOpeningName` tests |
| display cascade, both lists | opening name replacing the ECO line, and the fallback surviving |

Both repertoire lists already have `repertoires.test.ts` files (added under
#158), so display tests extend them rather than starting new files.

`updateRepertoireOpening` stays unit-untested, per the repo's convention that
`src/lib/server` is exercised through pure-logic tests plus manual
verification. It is a scoped single-column update mirroring `updateOpening`.

## Migration

`0078_repertoires_opening_id.sql` — one nullable text column. 0077 is the
highest currently in the tree.

Applied by hand in the Supabase dashboard, as every migration here is. Unlike
#123's RLS policy, this one **is** observable through PostgREST, so
`scripts/schema-check.ts` gains a probe for `repertoires (id, opening_id)` and
"was it applied" becomes answerable by command rather than by assertion — see
#196 for why that distinction matters.

## Verification

- `npm run check`, `npm run lint`, `npm test` clean.
- `npm run schema:check` passes its new 0078 probe.
- Manual: correct an opening on a coach repertoire and see the list change;
  choose "Auto" and see it revert to the derived value; confirm a repertoire
  outside the taxonomy still shows its ECO line.

## Non-Goals

- Per-student active mapping — #202.
- Any prep view, student or coach — #203.
- Full ECO coverage, or replacing `eco_code`/`eco_name`.
- Any progress state on openings. Epic #119's standing non-goal: progress
  belongs to repertoires.
- Authoring the list itself. The structure ships; the contents are the
  maintainer's to write, and the guard tests are what make an authoring mistake
  fail loudly.
