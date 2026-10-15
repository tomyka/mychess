# Per-chapter variation enumeration

## Problem

`enumerateVariations` (`src/lib/mastery/variations.ts`) walks a repertoire's entire move graph in one pass, enumerating every root-to-leaf path. Multiple PGN chapters imported into one repertoire share position/move rows wherever they transpose into the same edge (`positions` is globally deduped by FEN; `moves` is deduped per-repertoire on `(repertoire_id, from_position, san)` — see migrations `0001_core_tables.sql` and `supabase/config.toml`'s upsert conventions in `src/lib/server/pgn-import.ts`). When chapters diverge, reconverge into a shared position (a real transposition), and diverge again, the single whole-repertoire walk re-enumerates every downstream path once per way of reaching that shared position — the total path count multiplies at each reconvergence instead of adding up per chapter.

Confirmed against a real 414-chapter opening-reference PGN ("Freeze the French — Exchange Variation for White"): 17,431 total moves collapse to ~4,362 unique positions (heavy transposition), and walking the merged graph in one pass drove the local reproduction's heap to 4GB before an out-of-memory crash — reproduced directly against the real `planMultiImport`/`enumerateVariations` code, not a synthetic worst case.

This computation runs on nearly every repertoire touchpoint: `pgn-import.ts`'s own end-of-import shape-finalization step (so the crash can happen inline during upload, after every chapter's moves are already durably saved), `practice-repertoire.ts`'s `loadRepertoireVariations` (the exclusions endpoint and the variations-list endpoint both depend on it), and `repertoire-progress.ts`'s per-repertoire shape backfill. Once a repertoire is large/transposition-heavy enough to trigger this, every one of those becomes unusable — including the coach's own "deselect everything" bulk-exclude action, which is what surfaced this.

## Goals

- `enumerateVariations`'s total output size for a chaptered repertoire is the **sum** of each chapter's own variation count, never a product across chapters that share edges.
- Existing behavior for un-chaptered repertoires (a single-game/no-chapter-tag import — the common case) is unchanged; there's nothing to scope there.
- Legitimate branching **within** one chapter (a PGN's own annotated sidelines) still produces multiple variations for that chapter, same as today.
- Two chapters that happen to be textually identical lines both surface that line under their own chapter heading (matches how a real opening reference cross-references a shared tabiya under multiple names) — not deduplicated away.
- The fix is retroactive in principle (works from stored `moves` rows going forward), but this specific already-broken repertoire needs re-uploading once it ships — its already-saved rows don't carry the new per-move chapter membership, and there's no PGN text stored anywhere to backfill it from.

## Non-goals

- Making the already-imported "Freeze the French" repertoire work without a re-upload. Its interior moves are missing chapter-membership data that was never recorded; there's nothing to recover it from.
- General cross-chapter transposition *detection/reporting* as a feature (e.g. "this line also appears in chapter X") — out of scope; this is purely about keeping enumeration bounded and correct.
- Changing how `positions`/`moves` are deduped for storage. Global position dedup and per-repertoire move dedup both stay exactly as they are — only which chapter(s) a shared move belongs to becomes trackable.
- A defensive circuit-breaker/cap in `enumerateVariations` itself. The per-chapter scoping is the real fix; if a single chapter's own internal branching is ever pathological, that's a separate, much narrower problem to revisit if it actually occurs.

## Architecture

### Data model: `chapter_names` replaces `chapter_name`

Today, `moves.chapter_name` (migration `0042_move_chapter_names.sql`) is set **only** on a move that's a leaf within its own chapter's own raw move set (`chapterLeafFens` in `src/lib/pgn-import.ts`, computed before any DB write) — every interior/shared move is `null`, with no record of which chapter(s) actually use that edge.

New migration `0048_move_chapter_names_array.sql`:

```sql
alter table public.moves add column chapter_names text[] not null default '{}';
```

Every move — leaf or interior — gets its chapter written into this array at import time. A shared edge used by 50 chapters carries all 50 names. `moves.chapter_name` (singular) is dropped in a follow-up migration once the new column is confirmed working end-to-end (kept for one cycle rather than dropped in the same migration, so a mid-rollout failure doesn't lose the old column's data mid-flight).

No backfill for existing rows — per the Non-goals section, there's nothing to derive membership from for already-imported repertoires. New rows populate correctly; a repertoire imported before this ships keeps working exactly as it does today unless it's large/transposition-heavy enough to already be broken (this one), in which case it needs re-uploading.

### Import: merge membership instead of dropping the conflict

`src/lib/server/pgn-import.ts`'s move-writing step currently upserts with `{ onConflict: 'repertoire_id,from_position,san', ignoreDuplicates: true }` — the second chapter's conflicting insert is silently dropped, including whatever chapter name it would have contributed.

New sequence per chunk, replacing that single call:
1. `SELECT id, chapter_names FROM moves WHERE repertoire_id = ? AND (from_position, san) IN (...)` for the chunk's edges, to find which ones already exist and what they already carry.
2. Merge this chapter's own name into each row's existing `chapter_names` (dedupe; a chapter re-importing/re-touching its own edge doesn't duplicate its own name).
3. Upsert the chunk with the merged `chapter_names` arrays and `onConflict: 'repertoire_id,from_position,san'` **without** `ignoreDuplicates` — conflicting rows get their `chapter_names` (and other columns) overwritten with this call's values.

This flips a narrow, untested edge case: if two chapters disagree on `annotation` for the literal same edge, the **last** chapter processed now wins (previously the **first** chapter to create the row won, since `ignoreDuplicates` silently dropped every later conflicting write). No test pins the old behavior (`server/pgn-import.ts` has no dedicated test file, matching this codebase's established convention of not unit-testing the I/O layer directly — see CLAUDE.md). Accepted as a minor, non-functional behavior change.

### Algorithm: scope the walk per chapter

`src/lib/mastery/variations.ts`:

- `RawMoveRow.chapterName?: string | null` → `RawMoveRow.chapterNames?: string[]` (defaults to `[]` when omitted, same optionality rationale as today — existing hand-built test fixtures across the codebase that don't care about chapters don't need updating).
- `enumerateVariations(moves: RawMoveRow[]): Variation[]` becomes the *dispatcher*:
  ```ts
  export function enumerateVariations(moves: RawMoveRow[]): Variation[] {
    const chapterNames = uniqueChapterNames(moves); // first-appearance order across moves, deduped
    if (chapterNames.length === 0) return enumerateVariationsScoped(moves, null);
    return chapterNames.flatMap((name) => enumerateVariationsScoped(moves, name));
  }
  ```
  `uniqueChapterNames` walks `moves` in array order and collects each new name the first time any move's `chapterNames` contains it — deterministic, stable output order (matters for snapshot-style tests and for the practice picker's chapter list appearing in a consistent order across reloads).
- `enumerateVariationsScoped(moves, chapterName)` — the **existing** tree-walk algorithm, unchanged, except:
  - It first filters `moves` to those where `chapterName === null ? m.chapterNames.length === 0 : m.chapterNames.includes(chapterName)` — restricting the graph to just this chapter's own edges (or, for `null`, every move that belongs to no chapter at all — the un-chaptered case).
  - Every `Variation`/`VariationStep` it produces is stamped with `chapterName: chapterName` directly (the walk already knows which chapter it's enumerating — no need to re-derive it from a leaf's own tag the way today's code does via `path[path.length - 1].chapterName`).
- Public signature of `enumerateVariations` is unchanged (`RawMoveRow[] → Variation[]`) — every existing caller (`practice-repertoire.ts`, `repertoire-progress.ts`, `pgn-import.ts`) keeps working without changes to their own call sites, only to how they build the `RawMoveRow[]` they pass in (`chapterNames` instead of `chapterName`).

Why this bounds the count correctly: each `enumerateVariationsScoped` call only ever sees one chapter's own edges, so any cross-chapter transposition simply isn't part of that walk's graph at all — reconvergence can only happen *within* a chapter's own annotated branches, which is the legitimate, already-expected case (and is bounded by that one chapter's own PGN, not by however many other chapters exist in the repertoire).

### Callers

- `src/lib/server/practice-repertoire.ts`: `MOVE_SELECT_COLUMNS` selects `chapter_names` instead of `chapter_name`; `toRawMoveRows` maps `chapterNames: m.chapter_names ?? []` instead of `chapterName: m.chapter_name ?? null`.
- `src/lib/server/repertoire-progress.ts`: same column-name swap in its own moves select and row mapping.
- `src/lib/server/pgn-import.ts`: the finalize-shape step's `toRawMoveRows(allMoves)` call picks up the same mapping change automatically once `toRawMoveRows` (shared helper) is updated.
- `RepertoirePracticeRow.svelte`, `VariationPicker.svelte`: no changes — both consume `Variation[]`/`VariationRow` shapes that are unchanged (`chapterName: string | null` stays singular on the *output* type; only the *input* `RawMoveRow` type changes).

## Testing

- `src/lib/mastery/variations.test.ts`: new cases alongside the existing ones —
  - Two chapters sharing a prefix then diverging: total variation count is the sum of each chapter's own leaf count, not a product.
  - A single chapter with its own internal branching (today's existing behavior) is unaffected.
  - Two chapters producing the exact same full line: that line is enumerated once per chapter (two `Variation`s, same move-id path, different `chapterName`), not deduplicated away.
  - Un-chaptered moves (`chapterNames: []` on every row, or omitted) behave exactly as today's un-scoped walk.
  - A large synthetic case shaped like the real reproduction (many chapters sharing one prefix, each with a handful of unique continuation plies) completes in bounded time/memory instead of exploding — this is the actual regression test for the bug.
- `src/lib/server/pgn-import.test.ts` (if one gets added for this — check first; today there's a client-facing test at `src/lib/pgn-import.test.ts` only, not the server I/O file) is not required per this codebase's convention of exercising the I/O layer through the pure-logic tests and manual verification instead.
- Manual verification: re-upload the real "Freeze the French" PGN once this ships; confirm the import completes, the repertoire's practice-picker chapter list renders, and the whole-repertoire "deselect everything" checkbox succeeds without error.

## Rollout

1. Migration `0048_move_chapter_names_array.sql` (additive — new column, old one untouched).
2. Code changes (import, algorithm, callers) — deploy.
3. Manual re-upload verification of the real PGN (per Testing, above).
4. Follow-up migration dropping `moves.chapter_name` (singular) once the above is confirmed working, plus a small cleanup pass removing any remaining reads of it.
