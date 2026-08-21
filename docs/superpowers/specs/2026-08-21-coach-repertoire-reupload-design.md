# Coach repertoire re-upload

GitHub issue: [#118](https://github.com/tomyka/mychess/issues/118). Mockup: https://claude.ai/code/artifact/d6454dc1-583a-4cf2-8284-65ad6b46496d

## Problem

Coaches revise repertoires constantly — a new idea, a corrected move order, a line extended two plies. Today there is no update path. A coach can only re-upload, and both outcomes are bad: appending onto the existing repertoire never removes what they deleted, while creating a fresh repertoire means reassigning every student and discarding all their progress.

Four defects in the current import path (`src/lib/server/pgn-import.ts`):

1. **Append only.** `writeMoves` upserts on `onConflict: repertoire_id,from_position,san` and never deletes. A line the coach removed keeps being drilled forever.
2. **`chapter_names` merge, never replace** (`pgn-import.ts:270`, deliberate for multi-chapter imports sharing a prefix). On a re-upload, a renamed chapter leaves each move carrying both the old and new name, so `enumerateVariations` walks the line once per name — one copy a phantom.
3. **No visibility.** The coach gets a progress bar and a success toast. Nothing states which lines changed, or what the change cost students.
4. **Silent demotion.** A student's mastery drops with no explanation, which reads as a bug rather than as their coach revising the line.

## The enabling fact

`variation_key` is a `>`-joined chain of **move UUIDs**, which looks fatal for any update story. It isn't: `writeMoves` upserts moves on `(repertoire_id, from_position, san)` and `positions` is globally unique on `fen`. So re-uploading **onto the same repertoire row** preserves every unchanged edge's UUID, every unchanged variation keeps its key, and its progress rows match with zero work.

The whole design follows from that: update in place, never re-key, and spend the effort on the lines that genuinely changed.

## Decisions

Recorded with their reasoning because several of these were live alternatives.

- **In-place update on the same repertoire row.** Not a new repertoire per version. Preserves move UUIDs (above), so assignments, `assigned_repertoires` rows, and unchanged progress all survive untouched.
- **Progress identity stays per repertoire.** `variation_solved` / `variation_teaching_progress` / `variation_practice_exclusions` keep `unique(player_id, variation_key)`; under UUID keys that is already implicitly per-repertoire. Learning belongs to the repertoire, not to an abstract opening.
- **Content-addressed (SAN-path) keys are out of scope.** Evaluated at length. They would make progress portable across repertoire rows, which matters for two real cases — a coach who deletes a repertoire and re-uploads from scratch, and a line removed in one version then restored in a later one. But in-place update already handles the unchanged case for free, so content-addressing is hardening, not foundation. Deferred with one constraint recorded: doing it later would silently make progress *global*, so the uniqueness constraints would have to become `unique(player_id, repertoire_id, variation_key_hash)` (the `variation_key_hash` generated columns already exist from migration 0049). Re-keying is also the exact operation that has wiped learned progress before, so it should not ride along with this work.
- **Removed lines are retired, not deleted.** Empirically forced: `moves.id` is referenced `on delete cascade` by `reviews` (migration 0001) and `move_attempts` (0039), both still live — `move_progress` (0025) and `variation_progress` (0023) carried the same FK but were dropped in 0047 and 0051. Deleting a pruned move destroys the student's SRS scheduling state along with it, unrecoverably. Retiring also makes the whole apply non-destructive — prune becomes an `UPDATE`, so a failed apply cannot lose data — and lets a removed-then-restored line come back with its history. Cost is a filter in every enumeration query, accepted.
- **Chapters absent from the upload default to keep.** A coach exporting a single chapter must not silently delete the other four. Full-source-of-truth semantics were rejected for that reason.
- **Renames are detected and offered, never inferred silently.** Pure name matching treats a rename as delete-plus-add, which loses every affected student's progress. Both move sets are in hand at diff time, so overlap is cheap.
- **Rename threshold: 70%.** Offer a rename when an absent chapter's lines are at least 70% covered by exactly one new chapter, and that chapter is the best match. Below 70%, offer nothing — a bad guess presented as a default is worse than no guess. The coach can still declare a rename manually via *choose per chapter*.
- **Reconciliation is lazy, reusing migration 0055's freshness machinery — no new version column.** The spec originally proposed `repertoires.content_version` plus a per-student stamp. That is already built, in a narrower form: `repertoires.moves_updated_at` is maintained by `touch_repertoire_moves_updated_at` triggers on insert, update *and* delete of `moves` (0055), so no move write can escape it — including this design's retire-by-`UPDATE`. Reuse it as the staleness signal. Per-player stamps follow the same trick 0055 uses for `variation_practice_exclusions.verified_at`: stamp the repertoire's own `moves_updated_at` value rather than a clock reading, so the freshness test `stamp >= moves_updated_at` is satisfied without either side agreeing what time it is. Each student's progress reconciles on their next load of that repertoire. Avoids a write fan-out across every assigned student at apply time, and handles a student who is mid-session. Consequence for copy: the coach's "5 lines drop to review" is a projection, and the UI says *will*, not *did*.
- **A session in flight finishes on the material it started with.** Reconciliation happens on next load, not mid-session.
- **Every default is the non-destructive one.** Keep unmentioned chapters, accept a high-confidence rename, notify students. A coach who clicks straight through loses nothing; destruction requires a deliberate click.

## Goals

Each maps to an acceptance criterion on issue #118.

1. A coach can upload a PGN onto an existing repertoire and gets a **diff review** before anything is written.
2. Every variation in the upload is classified as **unchanged / extended / truncated / diverged / new / removed**, and the review shows counts per class.
3. The review states the **aggregate student cost**: "N learned lines drop to review across M of K students."
4. **Unchanged lines keep progress exactly** — no writes touch their rows.
5. **Extended, diverged and new-sibling lines keep progress up to the point of change**, via longest-common-prefix matching on move ids: `taught_plies` and `mastered_plies` clamp to the common prefix length.
6. `learned` (a `variation_solved` row) **survives only for unchanged and truncated lines**. Extended and diverged lines are demoted, logged in `variation_demotions` with a new cause `coach_update`.
7. **Chapters absent from the upload are surfaced**, default *keep*; removing them requires a deliberate click.
8. A likely **chapter rename is detected and offered**; accepting it preserves the existing move rows and therefore all progress under them.
9. **Removed lines stop being drilled** but their progress and SRS rows survive; restoring the line later restores its state.
10. The update leaves **no observable partial state** — any failure leaves the previous state exactly intact, and no student can reconcile against a half-applied shape. See the Applying section for why this is not literally one transaction.
11. Affected students **see why their progress changed**.

## Non-goals

- Content-addressed variation keys (see Decisions).
- Opening taxonomy and per-student active-repertoire mapping — [#119](https://github.com/tomyka/mychess/issues/119), independent of this.
- Changing the learning or mastery algorithm itself. Demotion reuses the existing mechanism; only its trigger is new.
- Coach-editable repertoires in the UI. This is file-driven.
- Per-student rollout control (holding one student on the previous version). Update is in place, so all assigned students get it. Version pinning belongs to #119.
- A version history browser or rollback UI. Retirement makes rollback *possible* to add later; it is not built here.

## Architecture

### Diff computation — pure, in `src/lib/`

Following the codebase's pure-logic / Supabase-I/O split, classification is a pure module with no database access.

`src/lib/repertoire-diff.ts`:

- `classifyVariations(existing: Variation[], incoming: Variation[]): VariationDiff[]` — takes both enumerated variation sets and returns one entry per line with its class and, for the non-unchanged classes, the common prefix length in plies.
- Matching is by move-id path for `existing` and by SAN path for `incoming` (incoming moves have no ids yet), joined through the position/SAN pairs the import already computes.
- `unchanged`: identical path. `truncated`: incoming is a strict prefix of existing. `extended`: existing is a strict prefix of incoming. `diverged`: shared prefix, then differing plies, and the existing line is gone from the incoming set. `new`: no existing line shares its full length — carries `inheritedPlies`, the longest common prefix with *any* existing line. `removed`: existing line absent from the incoming set entirely.
- `detectRenames(absentChapters, newChapters): RenameCandidate[]` — line-overlap ratio per pair, returning only pairs at or above the 0.7 threshold where the match is unambiguous.
- `projectProgressImpact(diffs, progressRows): ImpactSummary` — the counts and the student-cost sentence. Pure, so the same function produces the coach's projection and the per-student reconciliation.

Colocated `repertoire-diff.test.ts` carries the real coverage; this is where the five classes and the prefix arithmetic get pinned down.

### Applying — upsert, then one RPC, behind a deferral flag

The move upsert stays in application code: `writeMoves` already chunks positions and moves correctly and works around PostgREST's URL-length and `max_rows` limits, none of which exist inside Postgres. Reimplementing it in plpgsql would duplicate tested logic for no gain. Everything that must be consistent with everything else goes in the RPC:

`apply_repertoire_update(p_repertoire_id uuid, p_retire_move_ids uuid[], p_unretire_move_ids uuid[], p_chapter_renames jsonb, p_total_variations int, p_has_chapters boolean)`:

1. Lock the repertoire row, then authorize: caller owns it, or is an active coach of the owner.
2. `chapter_names` **replaces** rather than merges for chapters named in this upload; chapters not named in it keep theirs. This is the one behavioural change to existing import semantics, and it is scoped to the update path — the multi-chapter first-import path keeps merging, which is correct there.
3. Set `retired_at = now()` on `p_retire_move_ids`.
4. Clear `retired_at` on `p_unretire_move_ids` — a line the coach removed in one version and restored in a later one.
5. Recompute `total_variations` / `has_chapters`, and clear `update_in_progress_at`.

`moves_updated_at` needs no explicit bump — 0055's statement-level triggers fire on the upsert and on the retire `UPDATE`.

**Why the un-retire is in the RPC and not the upsert.** `moves` has no UPDATE policy granting a coach write access to a student-owned repertoire: `moves_player_all` is owner-only (0002), and `moves_coach_insert_for_student` (0020) is INSERT only. An app-side un-retire — whether as `retired_at: null` in the upsert payload or a separate `.update()` — therefore fails under RLS in exactly the coach case the feature exists for, and fails silently, since `retired_at` is not in `writeMoves`' payload at all. The `security definer` RPC has the privileges, the authorization check, and the row lock already. (The same RLS gap means the existing multi-chapter `chapter_names` merge upsert cannot work for a coach on a student-owned repertoire either — a pre-existing latent bug, filed separately.)

**Why `security definer` needs an explicit null guard.** The authorization check must be written `if auth.uid() is null then raise` followed by `v_owner is distinct from auth.uid()`. Written as `v_owner <> auth.uid()`, a NULL `auth.uid()` makes the whole condition NULL, `if NULL` is not taken, and the function proceeds to write — a definer function with no effective guard. `service_role` JWTs carry no `sub`, so `auth.uid()` is NULL there, and Supabase's default privileges keep `execute` for `service_role` regardless of `revoke ... from anon, public`.

**The deferral flag.** Because the upsert is a separate transaction from the RPC, there is a window where new moves are live and pruned moves are not yet retired — and 0055's trigger bumps `moves_updated_at` at the *start* of it. A student loading inside that window would reconcile against a half-applied shape, and reconciliation is destructive: the counts self-heal on the next reconcile, but a `variation_solved` row deleted on a phantom `diverged` classification does not come back, and the demotion log keeps a spurious `coach_update` row.

So `repertoires.update_in_progress_at timestamptz` is set immediately before the upsert and cleared by the RPC. Reconciliation skips entirely while it is set and non-stale, then runs once against the final shape. It is a timestamp rather than a boolean so a crashed apply cannot wedge a repertoire forever — a flag older than `UPDATE_FLAG_STALE_MINUTES` (10) is ignored.

Two known limitations, accepted rather than solved:

- **Concurrent applies can interleave.** The staleness check happens in the action before the upsert, and the RPC's `FOR UPDATE` does not cover the upsert, so two applies of the same repertoire can run upsert-A / upsert-B / RPC-A / RPC-B. Single-coach-per-repertoire makes this rare; the deferral flag means students see no partial state either way.
- **ABBA deadlock is possible.** The RPC locks `repertoires` then `moves`; a concurrent `writeMoves` upsert locks `moves` and then, via 0055's trigger, the same `repertoires` row. Overlapping move sets can deadlock, and Postgres aborts one side with `40P01`. A retry is safe.

### Retirement

`alter table public.moves add column retired_at timestamptz;`

Every read path that enumerates moves filters `retired_at is null`. The touch points are `fetchAllMoves` / `toRawMoveRows` in `src/lib/server/practice-repertoire.ts` — which is the single funnel for `enumerateVariations` callers — plus the `moves` reads in `src/lib/server/practice-pool.ts` and `src/routes/(player)/drill/+page.server.ts`. Concentrating the filter in `fetchAllMoves` is what keeps this from spreading; anything that needs retired rows asks for them explicitly.

### Reconciliation

`src/lib/server/repertoire-progress.ts` gains a reconcile step, running when a player loads a repertoire whose `moves_updated_at` is newer than their own reconciliation stamp. Per player:

- clamp `taught_plies` / `mastered_plies` on carried-forward keys
- delete `variation_solved` rows for demoted keys, inserting `variation_demotions` with cause `coach_update`
- seed new-sibling keys from their inherited prefix
- **rewrite** `variation_practice_exclusions` keys across a prefix match, so a student's "skip this" intent survives a coach's typo fix
- clear `practice_active_variation` if it points at a retired line
- stamp the player's reconciliation

**Ordering is load-bearing, and it is where this design collides with existing behaviour.** `reverifyExclusions` (`repertoire-progress.ts:132`) currently **deletes** any exclusion row whose key no longer names a live variation — correct under the old assumption that a vanished key means a vanished line, but wrong here: a line the coach merely extended gets a new key, and its owner's exclusion would be destroyed rather than carried. So reconciliation must run **before** `reverifyExclusions` on the same load, rewriting stale keys to their carried-forward equivalents; the prune then sees them as live and only genuinely-removed lines are deleted. Reconciliation is the thing that knows the old-key-to-new-key mapping, so this ownership split is the right one — but the two must not be reordered, and a test pins that.

The per-player stamp goes in a dedicated table rather than on `assigned_repertoires`, which only has a row for *assigned* repertoires — a coach practicing their own material has none:

```sql
create table public.repertoire_reconciliation (
  player_id     uuid not null references public.profiles(id) on delete cascade,
  repertoire_id uuid not null references public.repertoires(id) on delete cascade,
  reconciled_at timestamptz not null default 'epoch',
  primary key (player_id, repertoire_id)
);
```

`'epoch'` as the default is 0055's asymmetry trick reused deliberately: nothing is assumed reconciled at deploy time, so every player's first load per repertoire reconciles once, exactly as if the shape had just changed.

`variation_demotions.cause` currently checks `in ('mistake','hint')`; the constraint widens to include `'coach_update'`.

### Coach UI

`src/routes/(coach)/coach/repertoires/[repertoire_id]/update/+page.svelte`, reached from the repertoire detail page. Flow: choose file → parse and diff client-side (the parser already runs there for multi-chapter import) → review → apply.

Layout per the mockup: summary chip strip, chapter rail with per-chapter counts and a state stripe, line-by-line diff for the selected chapter, then the decision blocks (rename, absent chapters, notify), then apply. The diff rows render the change in place — struck old ply beside the new one — rather than describing it in prose.

Reuses `PgnImportForm.svelte`'s file-input and parse machinery; the chapter-at-a-time upload loop it owns is not reused, since apply is one call.

### Student notification

A repertoire whose `moves_updated_at` has moved past the player's reconciliation stamp shows an inline banner on the repertoire card and its practice screen: "Your coach updated this — N lines need review." N comes from the same `projectProgressImpact` used for the coach's projection, evaluated against that student's own rows at reconcile time. Dismissible; cleared once the affected lines are re-learned.

## Error handling

- **Parse failure** in the uploaded PGN: reported before any diff is shown, with the failing chapter named. Nothing is written.
- **Apply failure**: the RPC rolls back whole, and `update_in_progress_at` stays set until it goes stale, so no student reconciles against the partial shape in the meantime. A failed upsert leaves extra live moves but retires nothing — additive, never destructive. The coach sees what failed and can retry; a retry is idempotent because the diff is recomputed from current state.
- **A student loading mid-apply**: reconciliation is skipped while `update_in_progress_at` is set and under 10 minutes old. They practise the shape they loaded and reconcile on their next load after the apply completes.
- **Concurrent apply** (two coaches, or a double-submit): the SvelteKit action compares the repertoire's current `moves_updated_at` against the value the diff was computed from, *before* it writes moves. A mismatch aborts with "this repertoire changed since you started — reload to see the current diff" rather than applying a stale diff. The check cannot live inside the RPC: the move upsert runs ahead of it and bumps `moves_updated_at` itself, so an in-function check would reject the caller's own write every time. This is a TOCTOU — see the Applying section's known limitations.
- **Reconcile failure** for one student: logged, not fatal, version stamp not advanced — so it retries on their next load. Mirrors how `repertoire-progress.ts` already treats its lazy shape backfill.
- **A student mid-session** when an update lands: the session completes against the material it loaded. Reconciliation runs on next load.
- **Ambiguous rename** (two new chapters both above threshold for one absent chapter): no rename offered, both treated as new, absent chapter surfaced as usual. The coach resolves it via *choose per chapter*.

## Testing

Unit (`vitest`, colocated, following the pure-logic convention):

- `repertoire-diff.test.ts` — the five classes across real Najdorf paths, including the cases most likely to be got wrong: a diverged line whose divergence is on the *opponent's* ply; a new sibling that shares a prefix with a line the student has learned; a truncation that leaves `learned` intact; a line both extended *and* re-rooted; transposing chapters sharing a tail, which must not classify as one line.
- Rename detection at, just below, and just above threshold, plus the ambiguous two-candidate case.
- `projectProgressImpact` against fixture progress rows, asserting the coach-facing counts.
- Prefix clamping arithmetic: `mastered_plies` above the common prefix clamps down; below it is left alone.

Server (`src/lib/server/`, per convention exercised through pure tests plus manual verification): the RPC gets a manual pass against production with the service-role key on a throwaway repertoire — apply, verify unchanged progress untouched, verify demotions logged, verify a retired line stops being enumerated, then a rollback check by forcing a mid-apply failure.

E2E (`tests/*.e2e.ts`): coach uploads a revised PGN onto an assigned repertoire, sees the review, applies; student loads the repertoire and sees the banner with the expected count.

Existing tests to watch: `practice-progress.test.ts`, `repertoire-progress.test.ts` and `variation-practice-settings.test.ts` all construct `moves` fixtures, and adding `retired_at` to the read path must not break them — an absent field has to read as not-retired.

## Rollout

1. Migration: `moves.retired_at`, `repertoires.update_in_progress_at`, the `repertoire_reconciliation` table, widen the `variation_demotions.cause` check, add `apply_repertoire_update`. No new version column — `repertoires.moves_updated_at` (0055) is the staleness signal. The `cause` constraint is dropped by probing `pg_constraint` rather than by name: migration files in this repo have drifted from the live schema before, and a name-based `drop constraint if exists` that no-ops would leave two check constraints with the old one still forbidding `'coach_update'` — a migration that reports success and breaks at the first demotion insert. Written to `supabase/migrations/`, pasted by hand into the Supabase dashboard — there is no CLI link from this environment, so the migration must be confirmed applied before anything depends on it.
2. `retired_at is null` filter into `fetchAllMoves` first, on its own — a no-op until something retires a move, and it is the change with the widest read-path reach.
3. Pure diff module plus its tests.
4. The RPC and its server wrapper, verified manually.
5. Reconciliation.
6. Coach UI.
7. Student banner.

Steps 2 and 3 are independently shippable and carry no user-visible behaviour, which is where the risk in this work actually sits.
