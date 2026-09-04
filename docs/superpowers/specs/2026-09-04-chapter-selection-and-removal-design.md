# Chapter selection at upload, and chapter removal after

## Problem

A coach's PGN is not always all repertoire. A study exported from Lichess or ChessBase routinely mixes
the opening lines a student is meant to learn with material that is not repertoire at all — model games,
tactics sets, endgame positions, scratch chapters. `planMultiImport` imports **every** game in the file as
its own chapter, unconditionally, and there is no way to say "not that one".

The consequences are not cosmetic. Every non-repertoire chapter:

- inflates `total_variations` and `chapter_count`, so the dashboard's mastery denominators are wrong;
- adds its lines to the Learn plan and the Practice pool, so a student gets drilled on a 40-ply
  annotated Kramnik game as if it were theory;
- costs real import time — one `/api/repertoires/import-chapter` round trip each, on a path already slow
  enough to have needed a per-chapter progress bar.

The only existing remedy is per-chapter practice exclusions (`variation_chapter_practice_exclusions`,
spec `2026-08-19-per-chapter-practice-exclusions`): the student unchecks the chapter afterwards, one
student at a time, on material that should never have been theirs to see. And there is no remedy at all
for a chapter that turns out to be junk *after* the repertoire is already built and assigned — short of
deleting the whole repertoire and re-uploading it.

Two gaps, then:

1. **At upload:** no way to choose which chapters enter the repertoire.
2. **After upload:** no way to remove one chapter from a repertoire that exists.

## Goals

- The uploader picks which chapters are imported. Deselected chapters are **never written** — no
  `positions`, no `moves`, no contribution to any cached count.
- An untouched upload behaves exactly as it does today: every chapter, same result, same counts.
- A coach can remove a chapter from an existing repertoire, for every assigned student at once, and read
  the blast radius before confirming.
- Student progress rows survive a removal, so a chapter restored by a later re-upload comes back with its
  history intact.
- Removing one chapter never removes a line that another chapter still claims.

## Non-goals

- **No player-facing chapter manager.** A player can already hide a chapter from their own Learn *and*
  Practice via the chapter checkbox in the expandable row on `/learn`, `/practice` and `/repertoires`
  (`RepertoireVariationTree`, backed by `variation_chapter_practice_exclusions`; Learn honours it at
  `learn-units/+server.ts:38`). That capability ships today and is not being rebuilt — only its label
  changes, so it reads as what it is.
- **No UI to restore a removed chapter.** Removal is one-way from the coach's side. The underlying delete
  is still `moves.retired_at`, and re-uploading the PGN un-retires correctly through the existing update
  flow — but there is no "Removed chapters / Restore" section.
- **No "practice-only" chapter scope.** A chapter is either in the repertoire or not. Flagging an imported
  chapter as reachable by Practice but hidden from Learn was considered and rejected: the material this
  feature exists for is not repertoire at all, so the right answer is absence, not a scope flag.
- **No change to drilling, solved tracking, or the diff/re-upload flow's own behaviour.**
- **No change to `enumerateVariations`, `chapterTiers`, or how `chapter_names` is written at import.**

---

## Part 1 — Chapter selection at upload

### Shape: two steps inside one component

`PgnImportForm.svelte` (rendered by both `/coach/pgn` and `/repertoires/new`) gains a second step. No new
route and no extra server round trip: the PGN is already parsed client-side by `planMultiImport`, so
"Continue" is a local state transition.

**Step 1** keeps every field it has today (Name, Color, PGN textarea, Choose File, Google Drive). Its
submit button becomes **Continue**.

**A single-game PGN skips step 2 entirely** and imports exactly as it does today. The review screen appears
only when `plan.length > 1` — a one-chapter file has nothing to choose between, and making every upload pay
for a review screen is the one real cost of this shape.

**Step 2** is a new `src/lib/components/ChapterSelectionList.svelte`:

```
┌ Review chapters · freeze.pgn ─────────────────────────────────────────┐
│ 18 chapters found    5,118 lines total    15 selected · 4,048 import  │
│ ┌───────────────────────────────────────────────────────────────────┐ │
│ │ [–]  Chapter     Select all · Select none · Invert   [filter…]    │ │
│ ├───────────────────────────────────────────────────────────────────┤ │
│ │ [✓] 1) Rare Moves #1                          42 lines · 12 ply   │ │
│ │       1.e4 e6 2.d4 d5 3.exd5 exd5 4.Nf3…                          │ │
│ │ [ ] Model games — Kramnik                      2 lines · 44 ply   │ │
│ │     ⚠ 44 plies across 2 lines — looks like whole games            │ │
│ └───────────────────────────────────────────────────────────────────┘ │
│ ← Choose a different file             [Cancel]  [Import 15 chapters]  │
└───────────────────────────────────────────────────────────────────────┘
```

Behaviour, settled:

- **Everything starts checked.** Deselecting is the exception, so an upload where the coach touches nothing
  produces byte-for-byte today's result.
- The master checkbox is **tri-state**, matching the indeterminate pattern already used by
  `RepertoirePracticeRow` / `checkboxState.ts`.
- **With a filter active, "Select all" means all *visible* chapters**, and the control says so ("Select all
  6 matching"). Otherwise filtering and then selecting all silently re-checks the chapter just rejected.
- **Zero selected disables Import** rather than creating an empty repertoire.
- The advisory flag **never changes a checkbox's state.** A heuristic that silently deselected a chapter
  would lose a coach's lines without them noticing; it may only annotate.

### Per-chapter metadata: a pure `describeChapter`

New pure export in `src/lib/pgn-import.ts`, colocated test in `pgn-import.test.ts`:

```ts
export type ChapterDescription = {
  lineCount: number;   // enumerated variations
  maxPly: number;      // deepest line
  avgPly: number;      // mean line length
  openingLabel: string; // "1.e4 e6 2.d4 d5 3.exd5…"
  gameLike: boolean;   // the advisory flag
};

export function describeChapter(chapter: ImportChapter): ChapterDescription;
```

It runs `enumerateVariations` over the chapter's unwritten moves using the **same synthesized-id trick
`writeMoves` already uses** (`src/lib/server/pgn-import.ts:126-138`): dedupe on `fromFen|san`, assign
`id: String(i)`, `chapterNames: []`. `openingLabel` reuses `moveSequenceLabel(variations[0].path)`
truncated, so the numbering matches how move sequences are formatted everywhere else in the app.

Cost: for an 18-chapter, 5,118-line file this enumerates each chapter once, client-side, at the moment
the file is parsed — the same work `writeMoves` already does eagerly for a single-chapter import.
Computed once into state on the step-1 → step-2 transition, never re-derived per keystroke of the filter.

### The advisory `gameLike` flag

```
gameLike = avgPly >= 30 && lineCount <= 4
```

Long lines that barely branch. That is what a merged annotated game looks like and what a repertoire
chapter does not: repertoire theory fans out (many variations sharing prefixes) and stops well before ply
30, whereas a model game is one deep, near-linear path with a handful of side notes.

The hint renders the numbers that triggered it — "44 plies across 2 lines — looks like whole games" —
rather than a bare warning icon, so a coach whose genuinely deep theory chapter trips the rule can see
immediately why and ignore it. Purely advisory, per the rule above: it annotates, never deselects.

### Submit

`handleSubmit` filters `plan` to the selected chapters and hands the existing per-chapter loop the shorter
array. Everything downstream — `existingRepertoireId` threading, `finalize: false` on all but the last
chapter, the all-or-nothing rollback that `DELETE`s the shared repertoire on failure — is untouched.

Three intended knock-on effects:

- `isMultiChapter` is computed from the **selected** count, not `plan.length`. Selecting exactly one chapter
  therefore omits `chapterLabel` and produces a clean untagged repertoire, which is correct: one chapter has
  nothing to group. (A later re-upload of the full PGN still reconciles fine — the diff matches on SAN paths,
  and `absentChapters` is empty when the existing chapter set is empty.)
- `ecoCode` / `ecoName` come from the first **selected** chapter, since that is the call that creates the
  repertoire row.
- The existing per-chapter progress list shows only the selected chapters, because it is built from the
  filtered array.

### Testing (Part 1)

- `pgn-import.test.ts`: `describeChapter` line/ply counts against a known multi-variation chapter; the
  `gameLike` rule at and either side of both thresholds; `openingLabel` truncation.
- `ChapterSelectionList.test.ts` (jsdom pragma): tri-state master checkbox; select all / none / invert;
  "Select all N matching" under an active filter selects only visible rows; zero selected disables Import.
- `PgnImportForm.test.ts`: a single-game PGN never renders step 2; a multi-chapter PGN with two chapters
  deselected POSTs exactly the selected ones, with `chapterLabel` present and `finalize: false` on all but
  the last; selecting one chapter of many omits `chapterLabel`.

---

## Part 2 — Coach chapter manager

### Route

`src/routes/(coach)/coach/repertoires/[repertoire_id]/chapters/` (`+page.server.ts` + `+page.svelte`),
linked from the repertoire card on `/coach/repertoires` alongside the existing "Update" link
(`+page.svelte:107`).

### Load

Owner check as the update page's `load` does, then `fetchAllMoves` → `toRawMoveRows` →
`enumerateVariations` → `chapterTiers`, producing per chapter:

- `lineCount` — variations in this chapter's tier
- `sharedLineCount` — how many of those also belong to another chapter, and so will survive a removal
- `progressLineCount` — how many of this chapter's *exclusive* lines any assigned student has progress on:
  one count query against `variation_solved` and `variation_teaching_progress` filtered by those lines'
  `variation_key`s. Read-only, for the confirm dialog only; it never gates the removal.
- and, for the page as a whole, `assignedStudentCount` and `moves_updated_at`

### UI

The chapter list reuses `ChapterSelectionList` from Part 1 — one component, two callers — with
per-row **Remove** plus **Remove selected** for bulk.

**The component is polarity-neutral.** It renders a checkable chapter list with the bulk bar and the
metadata columns; what a checked row *means* belongs to the consumer. On the upload screen checked means
"will be imported"; on this page checked means "selected for removal", and the primary button spells that
out ("Remove 2 chapters"). The component therefore takes its heading, its bulk-bar labels and its primary
action as props rather than owning any of that copy — otherwise one of the two callers reads backwards.

The confirm dialog states the real blast radius before anything happens, and aggregates across every
chapter in the selection for a bulk removal (one dialog, summed counts, chapters named):

```
Remove "Model games — Kramnik"?

Retires 61 lines for all 4 assigned students.
23 of them carry student progress — kept, in case the chapter returns.
9 lines also belong to other chapters and will stay.
```

**Untagged repertoires.** A repertoire with `has_chapters = false` has one implicit `UNTAGGED_CHAPTER`
bucket; removing it would empty the repertoire. That row renders read-only, pointing at the existing
repertoire delete on `/coach/repertoires`. Selecting *every* chapter of a chaptered repertoire is blocked
the same way, with the same message — both client-side and in the action, since the action is the
authority.

### `?/remove` action

1. **`beginUpdate(supabase, repertoireId, movesUpdatedAt)`** — the exact conditional-UPDATE staleness claim
   the re-upload apply already uses (`repertoire-update.ts:230`). A removal computed against a shape that
   has since moved is refused with the same "reload and try again" instruction, so a concurrent re-upload
   and a removal cannot race. The page carries `moves_updated_at` in a hidden input, as the update page does.
2. **`planChapterRemoval(rawMoves, namesToRemove)`** — new pure module,
   `src/lib/repertoire-chapter-removal.ts`:

   ```ts
   export function planChapterRemoval(
     moves: RawMoveRow[],
     namesToRemove: readonly string[]
   ): {
     retireMoveIds: string[];
     totalVariations: number;
     hasChapters: boolean;
     chapterCount: number;
   };
   ```

   A move is retired **iff every one of its chapter names is being removed**. A move that keeps at least
   one name is kept and merely loses the removed ones — this is the same intersection-not-union subtlety
   the per-chapter exclusions spec had to get right, and getting it wrong here would silently retire lines
   a surviving chapter still needs to walk. The three cached-shape values are recomputed by enumerating the
   post-removal move set (removed names stripped, retired moves dropped).
3. **One `apply_repertoire_update` RPC call**, passing `p_retire_move_ids` from step 2, the new
   `p_remove_chapters`, and the three recomputed shape values. Empty `p_unretire_move_ids` and
   `p_chapter_renames`.

### Migration `0074_apply_repertoire_update_remove_chapters.sql`

Extends `apply_repertoire_update` with `p_remove_chapters text[]`, dropping the 7-argument overload first —
`create or replace` cannot change an argument list, the same `drop function` dance 0063 and 0069 each
performed. Two new steps, both before the existing retire step:

```sql
if array_length(p_remove_chapters, 1) > 0 then
  -- Strip the removed names from every move that carries one. A move left with
  -- no names is exactly a move in p_retire_move_ids; array_agg over an empty
  -- set returns NULL, hence the coalesce.
  update public.moves
    set chapter_names = coalesce(
          (select array_agg(n) from unnest(chapter_names) n where n <> all(p_remove_chapters)),
          '{}'::text[]
        )
    where repertoire_id = p_repertoire_id
      and chapter_names && p_remove_chapters;

  -- Orphaned per-chapter exclusions, across every player.
  delete from public.variation_chapter_practice_exclusions
    where repertoire_id = p_repertoire_id
      and chapter_name = any(p_remove_chapters);
end if;
```

Why in the RPC rather than app-side:

- **Atomicity.** It lands inside the same call that retires the moves and refreshes the cached shape, under
  the `select … for update` row lock the function already takes. A separate app-side update could leave
  `chapter_names` stripped but the shape stale, or vice versa.
- **The exclusion cleanup genuinely requires `security definer`.**
  `variation_chapter_practice_exclusions`' RLS is `player_id = auth.uid()`, and these rows belong to other
  players. Beyond tidiness, this stops a chapter resurrected by a later re-upload from coming back
  *pre-hidden* for whichever students had unchecked it.

Note the strip itself is no longer an RLS problem — migration 0068 gave a coach UPDATE on the moves of a
student-owned repertoire. The `moveIdsToUnretire` doc comment's RLS argument predates that migration;
atomicity is the reason here, not permissions.

The derived flat `variation_practice_exclusions` table may briefly disagree after a removal; the existing
freshness re-verification pass (`repertoire-progress.ts`, migration 0055) corrects it on the next load, the
same eventual consistency the exclusions spec already relies on.

**This migration must be applied manually** in the Supabase SQL editor — there is no DDL path from this
environment.

### Player-side copy change

The chapter row's label in `RepertoireVariationTree.svelte` becomes explicit that it hides the chapter from
*this player's own* Learn and Practice. New paraglide message keys, `en` and `lt`. No behaviour change.

### Testing (Part 2)

- `repertoire-chapter-removal.test.ts` (pure): a move whose only chapter is removed is retired; a move
  shared with a surviving chapter is not; a line shared across two removed chapters is retired; the three
  recomputed shape values against a known tree; `has_chapters` flips to false when the last chapter goes.
- Coach page tests: the untagged bucket renders read-only; selecting every chapter disables Remove; the
  confirm dialog reports the shared-line and progress-line counts; a bulk selection produces one dialog
  with summed counts.
- `ChapterSelectionList` is asserted in both polarities — the upload caller's "Import N chapters" and the
  manager caller's "Remove N chapters" — so a regression that hardcodes one caller's copy fails a test.
- `npm run qa:verify-learn` for the Learn-plan consequences, plus a manual pass on the real "Freeze the
  French" repertoire (1,873 of 5,118 move rows carry more than one chapter tag — the shared-line case this
  design turns on).

## Rollout

1. Part 1 ships independently — no schema change, no migration. It is the half that prevents the problem.
2. Migration `0074`, applied manually; confirmed by the user before Part 2's code is relied on.
3. Part 2's route, pure module, and RPC call.
4. Player-side copy change.
5. Manual verification against "Freeze the French" per Testing, above.
