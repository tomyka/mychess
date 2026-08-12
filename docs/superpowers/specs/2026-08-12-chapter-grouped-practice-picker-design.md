# Chapter-grouped Practice picker

GitHub issue: [tomyka/mychess#54](https://github.com/tomyka/mychess/issues/54)

## Problem

The Practice picker's per-variation checkbox list (shipped for #51) shows one row per leaf-to-root path produced by `enumerateVariations()` (`src/lib/mastery/variations.ts`). Every branch point — the opponent's replies, or the repertoire's own prepared alternatives — multiplies the variation count combinatorially. A real multi-chapter opening study ends up with far more checkbox rows than the PGN file's actual chapter/game count, making the list unmanageable.

The desired granularity is the boundary the PGN file itself already has — the same boundary `PgnImportForm.svelte`'s per-chapter upload-progress bar already steps through one tick at a time (`src/lib/pgn-import.ts`'s `planMultiImport`, one `ImportChapter` per PGN game/header block).

## Goals

- The Practice picker's checkbox list groups variations by their originating PGN chapter, with one collapsible header + bulk "check all/none" per chapter, instead of a flat list of every leaf variation.
- Chapter grouping is derived from real import-time data (the PGN's own chapter name), not re-guessed from move sequences.
- Newly-imported multi-chapter repertoires get grouping automatically; nothing is required of the user beyond importing as they do today.

## Non-goals

- **No change to mastery/level/queue-building logic.** `enumerateVariations()`'s output — one entry per leaf path — is untouched. Grouping is a picker-UI concern layered on top, not a redefinition of what a "variation" is.
- **No change to `alternativesAt()`/`continueFromBranch()`** (`src/lib/mastery/practice.ts`). An earlier version of this design considered literally collapsing each chapter into one variation (its mainline only); that was rejected because those two functions only ever surface alternatives that exist as their own `Variation` in `enumerateVariations()`'s output — collapsing would silently drop any alternate line inside a chapter's own PGN branches out of practice forever (never drilled, never counted, never offered as an alternative), reopening #29. Keeping `enumerateVariations()` untouched avoids this entirely.
- **No migration for already-imported repertoires.** The raw PGN text is never persisted anywhere (`PgnImportForm.svelte` parses it client-side; only derived move rows reach the server) — there is no source data left to derive chapter boundaries from after the fact. Repertoires imported before this feature ships will render with no chapter grouping (flat list, exactly today's behavior) unless the user re-imports the same PGN.
- **No change to single-chapter imports.** Grouping only matters when a repertoire has more than one chapter; a single-chapter import's variations are never tagged with a chapter name and render flat, as today.

## Architecture: tag chapter identity on `moves`, group only in the picker

Two shapes were considered:

1. **(Chosen) Tag the originating chapter on each chapter's own leaf moves, group client-side for display only.** `enumerateVariations()` stays exactly as it is. A new nullable `chapter_name` column on `moves` is set only on moves that close out a line *within their own chapter's move set* (every distinct ending, including sidelines from the chapter's own internal PGN branches — not just its mainline's final move). A `Variation`'s `chapterName` is whatever its leaf move carries. The picker's variations endpoint returns `chapterName` per variation; the UI groups by it.
2. **(Rejected) Collapse each chapter into exactly one `Variation`.** Simpler storage (one boolean flag suffices, no need to tag every internal leaf), but — per the Non-goals above — silently orphans any intra-chapter alternate line from practice forever. Rejected during design review once this consequence was traced through `alternativesAt()`.

Option 1 is what the rest of this document assumes.

## Data model changes

### New column: `moves.chapter_name`

```sql
alter table public.moves add column chapter_name text;
```

Nullable, no default, no index needed (only ever read alongside a `variation_key`-scoped fetch that's already fetching every move in the repertoire). Left null for every move that isn't a chapter's own leaf, and for every move written before this migration.

### Import: tag each chapter's own leaf moves

`planMultiImport` (`src/lib/pgn-import.ts`) gains a per-chapter computation: for each chapter's own `MoveRow[]`, find every `toFen` that is never used as another move's `fromFen` *within that same chapter* — this is every distinct line-ending inside the chapter, including sidelines from the chapter's own internal PGN branches (parenthesized RAV variations), not just its mainline's final move. Each such move gets `isChapterEnd: true`.

`writeMoves` (`src/lib/server/pgn-import.ts`) gains an optional `chapterLabel` param — the PGN chapter's own bare title (`ImportChapter.name`, e.g. `chapterName(headers, index)`'s output — "Ruy Lopez — Berlin Defense", not the combined `"{repertoire name} — {chapter title}"` string the repertoire-creation branch uses for `name`). When writing a chapter's moves, any move with `isChapterEnd: true` gets `chapter_name: chapterLabel` written to it; every other move gets `chapter_name: null`. `PgnImportForm.svelte` only sends `chapterLabel` for a multi-chapter import (mirroring the existing `finalize`/`existingRepertoireId` conditionals already threaded through the same call chain) — a single-chapter import never tags anything, matching the Non-goals above.

**Accepted edge case:** if two different chapters in the same import happen to write the exact same edge (`from_position` + `san`) as each other's leaf, the existing `ignoreDuplicates` upsert (already relied on for transposition merging) means whichever chapter's write lands first keeps its tag — the second chapter's tag for that specific shared edge is silently dropped. This mirrors the already-accepted move-collision trade-off from #51's design and is rare enough (two distinct chapters ending on the literal same position via the literal same move) not to warrant special-casing.

### Practice picker: expose and group by `chapterName`

- `RawMoveRow`, `VariationStep`, and `Variation` (`src/lib/mastery/variations.ts`) each gain a `chapterName: string | null` field. `enumerateVariations()` threads it through unchanged otherwise; a `Variation`'s `chapterName` is its leaf step's `chapterName`.
- `practice-repertoire.ts`'s `MOVE_SELECT_COLUMNS`/`toRawMoveRows` select and map the new column.
- `/api/repertoires/[id]/variations` (`GET`) includes `chapterName` per variation.
- `RepertoirePracticeRow.svelte` groups the loaded variation list by `chapterName`, preserving first-seen order: variations sharing a non-null `chapterName` render together under a collapsible chapter header with its own "check all/none" checkbox (same tri-state checked/unchecked/indeterminate + restore-on-recheck pattern already used for the repertoire-level checkbox, generalized to operate on an arbitrary subset instead of always "every variation"); variations with a null `chapterName` (every variation of an old, pre-feature repertoire, or of a single-chapter import) render exactly as they do today, no wrapper, no header.

## UI/UX: Practice picker (`/practice`)

```
▾ My Study                                     Level 3 of 6 · 12/18 solved
    ▾ Ruy Lopez (chapter)         [check all/none]
        ☑ 1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 4.Ba4
        ☑ 1.e4 e5 2.Nf3 Nc6 3.Bb5 Nf6
        ☐ 1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 4.Bxc6
    ▾ Italian Game (chapter)      [check all/none]
        ☑ 1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5
```

- Chapter header's checkbox reflects the aggregate of just its own variations (checked/unchecked/indeterminate), independent of the repertoire-level checkbox's own aggregate (which still reflects *every* variation regardless of chapter).
- Clicking a chapter header's checkbox is a bulk action over that chapter's variations only, using the same snapshot-and-restore behavior the repertoire-level checkbox already has (uncheck remembers what was checked; the next re-check restores exactly that, not "select everything").
- A repertoire with no `chapterName`-tagged variations (anything imported before this feature, or a single-chapter import) renders exactly as it does today — flat list, no headers.

## Testing

- Pure-logic tests (`src/lib/pgn-import.test.ts`) for the chapter-leaf detection that drives `isChapterEnd`, including a chapter with its own internal branch (two sidelines, two distinct leaves, both tagged).
- Pure-logic tests (`src/lib/mastery/variations.test.ts`) for `chapterName` flowing from a leaf move through to its `Variation`.
- Component tests (`RepertoirePracticeRow.test.ts`) for: chapter grouping renders a header + nested rows, the chapter checkbox's aggregate/indeterminate state, bulk toggle + restore scoped to just that chapter (not bleeding into a sibling chapter or the repertoire-level checkbox), and the no-`chapterName` case rendering unchanged (flat, no header) — a regression guard for every already-imported repertoire.
- `PgnImportForm.test.ts` extended to assert `chapterLabel` is sent per chapter for a multi-chapter import, and omitted for a single-chapter one.
- Manual end-to-end verification (Task 10 of the implementation plan): import a 2+ chapter PGN, confirm the picker groups by chapter with working bulk toggles, and confirm an *already-imported* repertoire (from before this change) still renders flat with no regression.
