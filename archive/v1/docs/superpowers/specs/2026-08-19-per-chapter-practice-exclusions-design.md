# Per-chapter practice exclusions

## Problem

`variation_practice_exclusions` (migration `0041_variation_practice_exclusions.sql`) stores exactly one "excluded from practice" flag per `(player_id, variation_key)` — a single line, wherever it appears, is either in the practice pool or out of it, full stop. The Practice picker's chapter tree (`RepertoireVariationTree.svelte`, `RepertoirePracticeRow.svelte`) reads and writes this same flag when you toggle a chapter or move-group checkbox.

That's a problem whenever a line legitimately appears under more than one chapter — which `moves.chapter_names` already supports and is common for a real, transposition-heavy repertoire (e.g. "Freeze the French — Exchange Variation for White": 1,873 of 5,118 move rows carry more than one chapter tag). Toggling one chapter's checkbox silently changes what a *completely different* chapter shows, because both chapters' UI happens to read the same single global flag for that shared line.

Confirmed directly against that repertoire's data and reported by the user: checking two specific chapters ("1) Rare Moves #3", "2) 4...Bg4 & 4...Bf5 #1") flipped many unrelated sibling chapters ("4...Bf5 with 6...Nc6 #1"–"#7", "4...Bf5 with 6...c6 #1"–"#7", etc.) to the indeterminate state, even though the user never touched them. The user's source PGN intentionally duplicates some lines across chapters (a "Rare Moves" roundup chapter that also appears as its own standalone chapter elsewhere), so the underlying data isn't wrong — but the expectation is that each chapter, as the coach structured it, is its own independent switch: "If I select just a single chapter, I expect that automatically it does not change any other chapters, even if some variations overlap."

Practice/drilling itself has no chapter concept at all (`practice-repertoire.ts` filters one flat pool by bare `variationKey`) — chapters exist only as a grouping/organizing concept in this picker screen. So the fix is scoped entirely to how exclusion is *stored and toggled*, not to drilling or progress tracking.

## Goals

- Toggling a chapter, move-group, or individual-line checkbox only ever changes what's displayed under **that specific chapter's own view** — never a sibling chapter's state for the same underlying line.
- The repertoire-level checkbox remains a true "everything" action: it still affects a line across every chapter it belongs to, in one click.
- A line stays in the practice pool as long as **any** chapter it belongs to still includes it — excluding it from one chapter's view doesn't remove it from practice if another chapter still wants it.
- The existing dashboard/picker fast-count optimization (`repertoire-progress.ts`, migration `0055_exclusion_freshness.sql` — GitHub issue #52) keeps working exactly as today, with no new per-load cost for repertoires that don't use per-chapter exclusion.
- Existing exclusion data migrates losslessly: before and immediately after this ships, the practice pool for every existing player/repertoire is identical. Only new per-chapter toggling changes anything going forward.

## Non-goals

- No change to practice/drilling itself, or to solved/progress tracking (`variation_solved`, `variation_teaching_progress`) — both stay keyed by bare `variation_key`, exactly as today, since drilling has no chapter concept to preserve.
- No change to how `moves.chapter_names` gets written at import time (`src/lib/server/pgn-import.ts`) or to `enumerateVariations`'s scoped-walk algorithm — both are correct and unrelated to this bug; this is purely about the exclusion-storage/toggle layer built on top of their output.
- No UI affordance explaining *why* a checkbox is indeterminate (e.g. "shared with chapter X") — out of scope; this fixes the toggle behavior, not picker transparency.

## Architecture

### Data model: a new per-chapter table, the old table becomes a derived cache

New table, migration `0057_variation_chapter_practice_exclusions.sql` (0056 was already taken earlier the same day by the guest-lookup fix — confirm against `supabase/migrations/` at implementation time in case another migration lands first):

```sql
create table public.variation_chapter_practice_exclusions (
  id                uuid primary key default gen_random_uuid(),
  player_id         uuid not null references public.profiles(id) on delete cascade,
  repertoire_id     uuid not null references public.repertoires(id) on delete cascade,
  chapter_name      text not null, -- UNTAGGED_CHAPTER's own string for the untagged bucket
  variation_key     text not null,
  variation_key_hash text generated always as (encode(digest(variation_key, 'sha256'), 'hex')) stored,
  created_at        timestamptz not null default now(),
  unique (player_id, chapter_name, variation_key_hash)
);

create index variation_chapter_practice_exclusions_player_repertoire_idx
  on public.variation_chapter_practice_exclusions (player_id, repertoire_id);

alter table public.variation_chapter_practice_exclusions enable row level security;

create policy "variation_chapter_practice_exclusions_player_all"
  on public.variation_chapter_practice_exclusions for all using (player_id = auth.uid());

revoke all on public.variation_chapter_practice_exclusions from anon, public;
```

A row's presence means "excluded, as viewed under this specific chapter." The existing `variation_practice_exclusions` table's **schema is untouched** — it becomes a derived cache of one fact per variation: "excluded under every chapter it belongs to" (i.e. actually excluded from practice). `repertoire-progress.ts`, `exclusionFreshness.ts`, and the dashboard summary count keep reading it exactly as today — this is what keeps the existing fast-count optimization intact with zero changes to that read path.

The write path (below) is what keeps the two tables in sync: every write to `variation_chapter_practice_exclusions` recomputes whether the affected variation is now excluded under *every* chapter it belongs to, and mirrors that single boolean into `variation_practice_exclusions` (insert/delete its one row) — self-healing, not strictly transactional with the per-chapter write (see Error Handling).

### Migration & backfill: reuse the existing freshness pass, not a one-off script

A variation's *true* chapter membership can only be computed correctly by walking the move graph (`enumerateVariations`) — a flat SQL union of every edge's `chapter_names` along a variation's path would over-count (exactly reproducing this bug in the backfilled data), so this can't be a pure-SQL backfill.

Instead, this reuses the existing self-healing re-verification pass in `repertoire-progress.ts` (`reverifyExclusions`), which already does a full move-fetch + `enumerateVariations` whenever a repertoire's `moves_updated_at` is newer than a player's exclusion rows' `verified_at`:

1. The migration sets `verified_at = 'epoch'` on every existing `variation_practice_exclusions` row, forcing every repertoire through the re-verify pass on its next load (mirroring exactly how `0055` itself rolled out).
2. `reverifyExclusions` gains one more step: for each currently-excluded variation, look up its freshly-enumerated `chapterNames`. If non-empty, write one `variation_chapter_practice_exclusions` row per real chapter name (the "expansion"). If empty (genuinely untagged), write a single row keyed by `UNTAGGED_CHAPTER` instead — there's only ever one "chapter" for an untagged line, so this is a 1:1 mirror of the existing flat row, not a fan-out.
3. The flat table is left exactly as it already is at this point — expansion doesn't change what's practiceable, only unlocks independent per-chapter toggling going forward.

Nothing user-visible changes during rollout: every player's practice pool reads identically before and after their first post-migration load.

### Write path: `setVariationsIncluded` becomes chapter-aware

`POST /api/repertoires/[id]/exclusions` gains a `chapter: string | null` field alongside the existing `variationKeys`/`included`:

- A real chapter name (including `UNTAGGED_CHAPTER`) scopes the write to exactly that chapter's own `variation_chapter_practice_exclusions` rows for the given keys.
- `null` is reserved for the repertoire-level checkbox only: the server resolves each key's own real chapter set itself and writes one row per real chapter for that key.

  Resolving a key's *real* chapters is cheap and doesn't need a full graph re-walk: a chapter genuinely belongs to a variation only if **every** move edge along that variation's path carries it (that's what makes `enumerateVariationsScoped` able to traverse the whole path within that chapter's own scope) — so it's the **intersection** of `chapter_names` across the path's edges, not their union. `moveIdsInVariationKey` already decodes a key into its ordered move-id chain; fetching those specific moves' `chapter_names` and intersecting them gives the correct set in one query, reusing the same move-ownership fetch `validateVariationKeysOwnership` already does. A naive union here would silently reintroduce this exact bug into the write path.

After writing, for every distinct `variationKey` touched, `setVariationsIncluded` re-derives "excluded under every real chapter" and syncs `variation_practice_exclusions`'s single row for that key accordingly.

### Read path: chapter-relative inclusion in the picker

`GET /api/repertoires/[id]/variations` changes each row's `included: boolean` to `includedByChapter: Record<string, boolean>` — one entry per chapter the variation belongs to (or a single `UNTAGGED_CHAPTER` entry). `RepertoireVariationTree`/`RepertoirePracticeRow` look up the entry for whichever chapter subtree they're currently rendering, rather than one flat value.

### Toggle scoping, top to bottom

`VariationSelection.toggleGroup` and `toggleVariation` both gain a `chapter: string | null` parameter:

- Repertoire-level checkbox → `chapter: null` (the one true "everything" action).
- Chapter and move-group checkboxes → their own chapter name.
- **Individual variation checkbox** → also scoped to whichever chapter subtree it's rendered under (confirmed with the user: a shared line's checkbox under chapter A is independent of its own checkbox under chapter B — consistent scoping all the way down the tree, not just at the chapter/group tier).

## Error Handling

- Reverts on a failed write keep the existing "only the rows this call touched" pattern already in `VariationSelection`, scoped to `(chapter, variationKey)` pairs instead of bare `variationKey`.
- The `variation_practice_exclusions` sync described above is best-effort: if it fails after the real per-chapter write already succeeded, it's logged (matching the existing `console.error('exclusions POST: write failed', ...)` pattern) rather than failing the whole request or rolling back the per-chapter write — the next freshness re-verification pass for that repertoire corrects any drift. No real cross-table transaction is attempted; the Supabase client doesn't cleanly support one across separate statements, and the existing freshness system already exists specifically to make this kind of eventual consistency safe.

## Testing

- `variation-practice-settings.test.ts`: extend for the new `chapter` param, the "resolve each key's real chapters and write N rows" path used by the repertoire-level checkbox, and the `variation_practice_exclusions` sync logic (a variation excluded under all its chapters mirrors to a flat row; excluded under only some does not).
- `repertoire-progress.test.ts`: new cases for the migration's re-verify-triggered expansion (a legacy flat row becomes N per-chapter rows on next verify, with no change to the computed `excludedVariationCount`/`total` in the same pass).
- `RepertoirePracticeRow.test.ts`: rewrite the existing cases that currently assert "a shared line stays in sync across chapters" (`shows a line belonging to two chapters under BOTH of them`, `toggling a shared line under one chapter shows as toggled under the other too`, and the chapter-level bulk-toggle cases touching `sharedLineResponse`) to instead assert independence — toggling the line under one chapter must not change its state under the other. Add a case confirming the repertoire-level checkbox still toggles a shared line under every one of its chapters at once.
- Manual verification (no live Postgres in this environment — per `mychess/CLAUDE.md`'s Database & migrations section): after deploying, re-check the real "Freeze the French" repertoire from this bug report — confirm checking one chapter no longer flips unrelated siblings, and that the dashboard's solved/total counts are unchanged from before the migration.

## Rollout

1. Migration `0057_variation_chapter_practice_exclusions.sql` (new table, additive) + the `verified_at = 'epoch'` reset on existing exclusion rows.
2. Code changes: `reverifyExclusions` expansion step, `setVariationsIncluded` chapter-awareness + flat-table sync, both API endpoints' shape changes, `VariationSelection`/picker component prop-threading.
3. Deploy.
4. Manual verification against the real "Freeze the French" repertoire (per Testing, above).
