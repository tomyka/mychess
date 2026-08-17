# Variation key uniqueness

## Problem

`variationKey` is `path.map((s) => s.moveId).join('>')` — it identifies a **line**, not a line-within-a-chapter. The per-chapter enumeration added on 2026-08-15 (to fix a real out-of-memory crash from cross-chapter path multiplication) walks each chapter's own edges separately and concatenates, so a line belonging to N chapters is emitted N times with an **identical key**. `variations.test.ts` currently asserts this explicitly.

Every consumer still assumes one key = one list entry. Four confirmed bugs follow, all verified by running the real code:

1. **Infinite server hang (critical).** `nextVariation` (`src/lib/mastery/variationSequence.ts:29`) uses `findIndex`, which always returns the *first* match. When two adjacent entries share a key, `advanceIfSolved`'s `while` loop (`:47-51`) alternates forever. Verified: 10,000+ iterations with no exit. Trigger: a multi-chapter PGN cross-referencing the same tabiya (exactly the case the current test enshrines), player solves that line → CPU spins until the serverless function is killed, and the attempt never records. The same root cause also teleports players backwards on *non*-adjacent duplicates — verified: solving the copy at index 3 advances to index 1, skipping the rest of that chapter.
2. **Cross-chapter state bleed.** `variation_solved`, `variation_practice_exclusions` and `variation_teaching_progress` are all keyed `(player_id, variation_key_hash)`, so acting on a shared line under one chapter silently applies to every other chapter's copy.
3. **Inflated totals.** `total_variations` is `variations.length`, which counts a shared line once per chapter, so "M / N solved" can be wrong and can jump by more than one.
4. **Untagged lines silently vanish.** `enumerateVariations` only walks the untagged (`null`) scope when *no* move carries a chapter tag. In a **mixed** repertoire — some moves tagged, some not — untagged lines are never walked at all. Verified: a mixed set with 2 lines returned 1 variation. Reachable when a chaptered import is appended onto a repertoire holding pre-0048 (untagged) moves.

Relatedly, `VariationPicker.svelte:47-60` builds its chapter list with `chapterName ?? ''` but filters rows with `=== ''`, while rows hold `null` — so a mixed repertoire renders a blank, unlabeled chapter that opens an empty list.

## Goals

- `enumerateVariations` returns each distinct line **exactly once**, so `variationKey` is unique within a repertoire again.
- Enumeration stays bounded per chapter — the 2026-08-15 OOM fix must not regress.
- Untagged lines in a mixed repertoire are enumerated and reachable in the UI.
- No key-format change, so existing `variation_solved` / `variation_practice_exclusions` / `variation_teaching_progress` / `practice_active_variation` rows keep matching. **No data migration.**
- Solving or excluding a shared line applies wherever it appears (decided: one line = one progress record).

## Non-goals

- Per-chapter progress tracking for a shared line. Explicitly rejected: it would require chapter-scoped keys, orphaning all existing progress with no reconstructable migration (a shared old key has no record of which chapter it belonged to), and would force a line shared by 20 chapters to be solved 20 times.
- Changing how `positions`/`moves` are deduped at import, or the `chapter_names` column added in 0048.
- Reworking the practice/teaching algorithms themselves.

## Architecture

### One variation per line, carrying its chapters

`Variation.chapterName?: string | null` becomes `chapterNames: string[]` — every chapter the line appears in, in first-appearance order. An empty array means untagged.

`enumerateVariations` keeps its current per-chapter dispatch (which is what bounds the work), then **merges** results by `variationKey`:

```ts
export function enumerateVariations(moves: RawMoveRow[]): Variation[] {
  const chapterNames = uniqueChapterNames(moves);
  const hasUntagged = moves.some((m) => (m.chapterNames ?? []).length === 0);

  const scopes: Array<string | null> = [...chapterNames];
  // Always walk the untagged scope when untagged moves exist — not only when
  // NOTHING is tagged. This is what fixes bug 4: in a mixed repertoire the
  // untagged lines used to be walked by no scope at all.
  if (hasUntagged || scopes.length === 0) scopes.push(null);

  const byKey = new Map<string, Variation>();
  for (const scope of scopes) {
    for (const v of enumerateVariationsScoped(moves, scope)) {
      const existing = byKey.get(v.variationKey);
      if (!existing) {
        byKey.set(v.variationKey, v);
      } else if (scope !== null && !existing.chapterNames.includes(scope)) {
        existing.chapterNames.push(scope);
      }
    }
  }
  return [...byKey.values()];
}
```

`enumerateVariationsScoped` is unchanged except that it stamps `chapterNames: scope === null ? [] : [scope]` instead of `chapterName: scope`.

Why this fixes each bug: keys are unique because the map is keyed on them (1 — the hang becomes structurally impossible, not merely guarded); one entry per line means one progress row per line (2 — the bleed becomes the intended semantics); `variations.length` counts lines (3); the untagged scope is always walked when relevant (4).

Insertion order gives a deterministic result: a line appears at the position of its first-encountered chapter, chapters run in first-appearance order across `moves`, and the untagged scope comes last.

### `VariationStep.chapterName` is removed

Currently every step is stamped with its walk's chapter. Nothing reads it (verified by grep: only `variations.ts` writes it; `groupByFirstMoves`, `moveSequenceLabel`, and both picker components use steps but never inspect `chapterName`). After merging, a step could belong to several chapters, so the field would be actively misleading. Delete it rather than maintain a plural version nothing consumes.

### `hasChapterTags`

`variations.some((v) => v.chapterName != null)` → `variations.some((v) => v.chapterNames.length > 0)`. Same meaning, new shape.

### Defence in depth in `variationSequence.ts`

Uniqueness now holds at the source, so `findIndex` is correct. But a hang is a severe enough failure mode to guard independently of an upstream invariant: `advanceIfSolved` gains a visited-key set so it terminates even if a duplicate ever reappears. A unit test asserts `enumerateVariations` output has unique keys, enforcing the invariant where it is created rather than only where it is consumed.

### UI: chapter filtering, and a home for untagged lines

Both `RepertoirePracticeRow.svelte` and `VariationPicker.svelte` change their row type to `chapterNames: string[]` and their filters from equality to membership:

- `rowsForChapter(name)`: `rows.filter((r) => r.chapterNames.includes(name))`
- `chapters` derivation: flat-map every row's `chapterNames`, dedupe preserving first-appearance order, and return `null` only when no row has any chapter (unchanged semantic — that's the "skip the chapter tier" case).

This removes `VariationPicker`'s `chapterName ?? ''` / `=== ''` mismatch by construction: there is no longer a null to coerce.

**Untagged lines in an otherwise-chaptered repertoire** would match no chapter and so be unreachable in the picker — the same invisibility as bug 4, just moved into the UI. They get an explicit bucket instead, rendered last, using a module-level constant (not a magic string) for its label and treated as a real chapter for selection/expansion purposes. It appears only when such rows exist.

`/api/repertoires/[id]/variations/+server.ts` sends `chapterNames: v.chapterNames` in place of `chapterName`.

### Cached totals must be invalidated

`repertoires.total_variations` was computed with the double-counting `length`, so every chaptered repertoire's cached value is inflated. `repertoire-progress.ts` already lazily backfills the cache when it is `null`, so a one-statement forward migration nulling the column is enough to make every repertoire recompute correctly on next load. This is cache invalidation, not a data migration — no player progress is touched.

```sql
update public.repertoires set total_variations = null, has_chapters = null;
```

`has_chapters` is nulled alongside it because the same lazy backfill computes both together.

## Testing

- `variations.test.ts`: **invert** the existing "enumerates a fully-shared line once per chapter" test — the line is now ONE variation whose `chapterNames` holds both. Add: merge across three chapters; a mixed repertoire enumerating both tagged and untagged lines (the bug-4 regression test); every returned key is unique (the invariant); the 12-checkpoint additive/non-exponential shape still passes unchanged (proving the OOM fix is intact); deterministic ordering.
- `variationSequence.test.ts`: duplicate keys terminate rather than hang (a direct regression test for the verified infinite loop), and non-adjacent duplicates don't advance backwards.
- `RepertoirePracticeRow.test.ts` / any `VariationPicker` tests: a line appearing under two chapters shows under both and toggles consistently from either; the untagged bucket appears in a mixed repertoire and is selectable; existing tests updated for the `chapterNames` shape.
- Full `npm test` and `npm run check` must stay at 0 errors.

## Rollout

1. Code change (pure logic + two components + one API route), deployed.
2. Run the cache-invalidation migration.
3. No user action needed; no player progress is migrated or lost.
