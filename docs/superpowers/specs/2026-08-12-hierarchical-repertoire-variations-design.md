# Hierarchical repertoire → variations

GitHub issue: [tomyka/mychess#51](https://github.com/tomyka/mychess/issues/51)

## Problem

Multi-chapter PGN imports (e.g. a Lichess Study export with one game per branching line of an opening) currently create **one `repertoires` row per chapter**. A single opening with 7 variations shows up as 7 separate top-level repertoires in the Repertoires list and Practice picker, each with its own independently-computed mastery level, instead of reading as one opening with 7 lines.

This is not a limitation of the variation logic — `enumerateVariations()` (`src/lib/mastery/variations.ts`) already walks a *single* repertoire's move graph and reports one entry per root-to-leaf path, so branches within one PGN game (or one `importGames()` call) already merge correctly. The bug is specifically in the **multi-chapter import path**: `PgnImportForm.svelte` calls `/api/repertoires/import-chapter` once per chapter, and each call's `writeMoves()` (`src/lib/server/pgn-import.ts`) inserts a brand new `repertoires` row.

## Goals

- Multi-chapter PGN imports produce **one repertoire** whose variations are derived the normal way (`enumerateVariations()`), not N separate repertoires.
- The Practice picker shows each repertoire as a single collapsed line, expandable to reveal its variations.
- Each repertoire and each variation gets its own "include in practice" checkbox. Default: repertoire selected, all variations selected.
- Already-split repertoires in the current (pre-launch, single-user) database get merged back into one via a provided migration script.

## Non-goals

- No change to spaced-repetition/scheduling logic — checkboxes only change which variations are *eligible*; existing queue/level-building logic runs unchanged over the filtered set.
- No preservation of original PGN chapter names as variation labels. Variations are labeled by a live move-sequence preview instead (see "Variation labels" below).
- No progress-preserving remap during the merge migration. Where two chapters' moves collide on the same edge, the migration keeps one and drops the other; any move-scoped progress tied to the dropped edge may reset. Accepted given there are no real users yet.

## Architecture: merge into one move tree, not a new parent/child hierarchy

Two shapes were considered:

1. **(Chosen) Merge chapters into one repertoire's move tree.** `enumerateVariations()` already produces exactly the "repertoire → variations" hierarchy this feature needs, for free, the moment chapters stop being written as separate repertoire rows. No new grouping table, no new concept to thread through RLS/assignment/level-cap code.
2. **(Rejected) Add a `parent_repertoire_id` container column.** Each chapter keeps its own repertoire row; a new lightweight "container" row groups them. Preserves original chapter names for free, but introduces a second repertoire-like entity that has to be taught to every place that currently assumes one repertoire = one move tree = one mastery level (list pages, practice detail page, coach assignment, RLS policies, `practice_depth_levels`/level-cap math). Two sibling rows also can never merge on a shared position the way a real opening transposition should.

Option 1 is recommended and is what the rest of this document assumes.

## Data model changes

### Import: merge chapters instead of splitting

`writeMoves()` (`src/lib/server/pgn-import.ts`) gains the ability to **append** to an existing repertoire instead of always inserting a new one:

- The first chapter of a multi-chapter import creates the repertoire row as today.
- Each subsequent chapter's moves are upserted against that same `repertoire_id`, using the existing `unique(repertoire_id, from_position, san)` conflict target with `ignoreDuplicates` — this is the exact mechanism `importGames()` already relies on to merge multiple games sharing an opening sequence into one shared tree.
- After the last chapter is written, the cached shape (`total_variations`, `total_levels`, `level1_task_count` — see `repertoireShape()` in `src/lib/mastery/levelProgress.ts`) is recomputed once over the repertoire's full accumulated move set and written to the row, replacing the current per-chapter-only shape calculation.
- `PgnImportForm.svelte`'s per-chapter progress bar is unaffected — it still shows one tick per chapter POST; only the server-side effect of each POST changes (append vs. insert-new).

### New table: per-player variation exclusions

Repertoires can be assigned by a coach to multiple students via `assigned_repertoires` (same row, many players) — so "included in practice" cannot be a column on `repertoires` itself, or one student's exclusion would affect every other student assigned the same repertoire. It has to be per-player state, exactly like the existing `variation_progress` table (`player_id` + `variation_key`, unique together).

```sql
create table public.variation_practice_exclusions (
  id            uuid primary key default gen_random_uuid(),
  player_id     uuid not null references public.profiles(id) on delete cascade,
  repertoire_id uuid not null references public.repertoires(id) on delete cascade,
  variation_key text not null,
  created_at    timestamptz not null default now(),
  unique (player_id, variation_key)
);

alter table public.variation_practice_exclusions enable row level security;

create policy "variation_practice_exclusions_player_all" on public.variation_practice_exclusions
  for all using (player_id = auth.uid());

revoke all on public.variation_practice_exclusions from anon, public;
```

- **Presence of a row = excluded.** Absence = included. This makes "default: everything selected" free — nothing needs to be written at import time, and nothing needs to be written for a normal player who never touches a checkbox.
- `variation_key` uses the same scheme as `variation_progress` (the joined chain of real move-row ids along the path), so it stays stable as long as the underlying moves aren't deleted — consistent with the existing assumption that moves are immutable after import.
- Unchecking a repertoire's top-level checkbox writes one exclusion row per variation currently in that repertoire. Unchecking a single variation writes one row. Re-checking deletes the corresponding row(s).

### Practice queue filtering

`loadRepertoireVariations()` (`src/lib/server/practice-repertoire.ts`) currently returns every `enumerateVariations()` result unfiltered. It gains one step: fetch this player's exclusion rows for the repertoire and drop any variation whose `variationKey` is excluded, before the result reaches level/queue-building logic (`levelProgress.ts`, `practice.ts`). This is the only place filtering needs to happen — everything downstream (level counts, queue, mastery %) already operates purely on whatever `Variation[]` it's handed.

## Migration for already-split repertoires

A one-off Node script (following the `scripts/import-fide.ts` precedent — run manually by the user, since this environment has no working service-role key):

1. Group existing repertoires by `(player_id, color, base name)`, where base name strips the `" — {chapter name}"` suffix that `PgnImportForm.svelte` currently appends (`name.split(' — ')[0]`). Groups of size 1 are left alone.
2. Within each group, pick the earliest-created repertoire as canonical.
3. For every other member of the group: re-parent its `moves` rows onto the canonical `repertoire_id`. Where a move collides with an existing edge on the canonical repertoire (same `from_position` + `san`), drop the duplicate rather than erroring — mirroring the `ignoreDuplicates` merge behavior used at import time.
4. Recompute `total_variations`/`total_levels`/`level1_task_count` on the canonical row via `repertoireShape(enumerateVariations(...))` over its full merged move set.
5. Delete the now-empty sibling repertoire rows (cascades clean up their remaining child rows).

**Accepted trade-off:** progress (`variation_progress`, `reviews`) tied to a dropped duplicate move's id is not remapped and may reset for that specific line. Since the app has no real users yet, this is acceptable; a progress-preserving remap is not built.

## UI/UX: Practice picker (`/practice`)

This is the only page that changes structurally (the Repertoires management list at `/repertoires` stays a flat list — unrelated to what to practice).

Each repertoire renders as a single collapsed row:

```
▾ Ruy Lopez                                    Level 3 of 6 · 12/18 solved
    ☑ 1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 4.Ba4 Nf6
    ☑ 1.e4 e5 2.Nf3 Nc6 3.Bb5 Nf6 4.O-O Nxe4
    ☐ 1.e4 e5 2.Nf3 Nc6 3.Bb5 g6
```

- **Collapsed by default.** A chevron/disclosure toggle expands to show variations; this is purely client-side UI state, not persisted.
- **Variation label**: a move-sequence preview built live from `Variation.path` (no new naming schema, no dependency on preserving PGN chapter names).
- **Repertoire-level checkbox**: reflects the aggregate of its variations —
  - all checked → checked
  - none checked → unchecked
  - some checked → **indeterminate** (native tri-state checkbox)
- **Clicking the repertoire checkbox** is a bulk action, not independent stored state:
  - From checked/indeterminate → unchecked: snapshot the current per-variation checked set in local component state, then write exclusion rows for every variation.
  - From unchecked → checked: if a snapshot exists from the immediately-preceding bulk-uncheck, restore exactly that per-variation state (delete exclusion rows only for the variations that were checked in the snapshot); otherwise (no prior snapshot in this visit) simply clear all exclusions for the repertoire.
- **Each variation checkbox** independently toggles its own exclusion row and updates the parent's aggregate/indeterminate display.
- Checkbox changes save immediately (no separate "Save" button) — consistent with there being no existing save-confirmation pattern elsewhere in the app for this kind of per-item toggle.
- Clicking the repertoire name (as today) still navigates into `/practice/[repertoire_id]` to start a session; the session's queue reflects whatever is currently checked.

No new visual language is introduced beyond a standard checkbox (matching the existing `<input type="checkbox">` + label idiom at `src/routes/settings/+page.svelte:228`) and a disclosure chevron.

## Testing

- Pure-logic tests (`src/lib/`) for: the merge-on-append behavior of `writeMoves()`'s move-dedup logic (already partially covered by `importGames()`'s existing merge tests — extend for the multi-call/append case), and the exclusion-filtering step feeding into level/queue building.
- The migration script is exercised manually against real (test) data before being considered done, per this repo's existing convention for scripts that touch production data.
- Component-level test for the parent/variation checkbox aggregate + indeterminate + snapshot-restore behavior described above.
