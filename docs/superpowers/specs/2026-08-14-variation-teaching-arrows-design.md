# Variation teaching arrows

GitHub issue: [tomyka/mychess#60](https://github.com/tomyka/mychess/issues/60)

## Problem

Practice mode currently quizzes a variation's entire path blind from the very first attempt: a player picking (or being sequenced into) a variation they've never seen has no way to learn its moves except by guessing, failing, and eventually stumbling onto the book line — there's no notion of "first exposure" versus "review." The only existing assistance is the 3-wrong-attempts-triggered origin-square hint (`hintSquare` in `ChessBoard.svelte`), which only ever appears after repeated failure, not on introduction.

Issue #60 asks for a Chessbook-style guided-then-tested move introduction: show the correct move on first exposure, then test it blind afterward. This spec scopes a version of that for the variation-picker/depth-progress architecture already shipped (`2026-08-13-mastery-per-variation-practice-redesign-prd.md`): teach a variation's moves in fixed-size batches, deepest-first, with a full blind replay required between batches.

## Goals

- The first `FIRST_MOVES_GROUP_PLIES` (10) plies of any variation — 5 full moves — are never arrow-taught. This matches the picker's own move-sequence preview, which already shows exactly this many plies as the variation's label text; a player who picked the variation has already seen them.
- Every 10 plies beyond that are taught once, via a yellow arrow on each new ply's correct move, then confirmed via one clean blind replay from the very start of the variation before the next batch is introduced.
- The player always plays every move themselves — an arrow reveals the destination, it never auto-plays the move.
- A mistake during a blind replay is just a retry of that same blind replay; it never re-triggers teaching for moves already taught.
- The existing "one clean full replay marks the variation solved" mechanic (`variation_solved`, `applyAttemptResult`) is preserved exactly as-is once a variation reaches its final batch — this feature only changes what happens on the way there.

## Non-goals

- **No change to `variation_solved`'s meaning or the repertoire-wide "M of N solved" count.** A variation only counts as solved once it's been cleanly replayed start-to-leaf at full depth, exactly as today.
- **No change to the 3-wrong-attempts origin-square hint.** It continues to exist independently, including during a taught or blind-retest pass.
- **No re-teaching of already-solved variations.** A variation already in `variation_solved` — including ones solved before this feature ships — is always served at full depth with no arrows, regardless of what (if anything) is in its teaching-progress row.
- **No new UI chrome indicating "you're in a teaching pass."** The arrow itself is the only signal; no banner, label, or progress-within-the-variation indicator is added.
- **No per-alternative teaching.** If a repertoire preps multiple replies at one position (see #29), this feature doesn't change how those are surfaced — it only decides whether the single path being played shows arrows.

## Architecture: batch depth as two ply-counters, resolved fresh on every serve

Two approaches were considered:

1. **(Chosen) Two persisted counters per `(player, variation)`: `taught_plies` and `mastered_plies`.** A pure function derives, from these two counters plus the variation's own path length, exactly what the next attempt should look like: how much of the path to serve, and whether any ply range gets an arrow. Nothing about "which phase we're in" is stored directly — it's always recomputed from the two counters, the same way `pickActiveVariation` already recomputes the active variation from stored state rather than trusting a cached phase.
2. **(Rejected) Store an explicit phase enum (`teaching` / `retesting` / `done`) plus a batch index.** More fields for the same information — `taught_plies`/`mastered_plies` already imply the phase (see below), and deriving it keeps the persisted state minimal and self-healing the same way the rest of this architecture already relies on (`practice_active_variation`, `variation_solved`) — a corrupted or stale phase enum could disagree with the counters, while a derived phase never can.

### Deriving the current step

Given a variation's full `path: VariationStep[]` and its two counters:

```ts
const freeZone = Math.min(FIRST_MOVES_GROUP_PLIES, path.length); // 5 moves, never taught
const taught = Math.max(taughtPlies, freeZone);
const mastered = Math.max(masteredPlies, freeZone);
```

(The `Math.max(..., freeZone)` floor means a missing or all-zero row behaves exactly like "the free zone is already both taught and mastered" — no backfill migration is needed for pre-existing variations; see Edge Cases.)

- **`mastered >= path.length`:** every batch is mastered. Serve the full `path`, no arrow. This is a normal attempt exactly as today, and a clean replay marks the variation solved exactly as today.
- **`taught === mastered` (and `mastered < path.length`):** the next batch hasn't been taught yet. Target depth `= min(mastered + FIRST_MOVES_GROUP_PLIES, path.length)`. Serve `path.slice(0, target)`, with an arrow on every ply in `[mastered, target)` — the whole new batch, every ply, every time this pass is shown. A clean replay advances `taught_plies` to `target`; `mastered_plies` is untouched. A mistake changes nothing (the same teach pass is re-served next attempt).
- **`taught > mastered`:** the just-taught batch needs one clean blind replay before it counts. Serve `path.slice(0, taught)`, no arrow. A clean replay advances `mastered_plies` to `taught` (and, if `taught >= path.length`, this attempt was the real full-depth attempt — marks the variation solved exactly as today). A mistake changes nothing — this exact blind pass is re-served next attempt, per Goals.

This is a small number of states because "teach" and "blind-retest" always alternate one-for-one per batch, and the final batch's blind-retest *is* the ordinary full-variation attempt — no separate "fully taught" concept is needed on top of `variation_solved`.

### Already-solved variations bypass this entirely

`variation_solved` is checked before any of the above: if the active variation's key is already in the player's solved set, it's served at full depth with no arrow unconditionally, and the teaching-progress row (if any) is never read. This is what makes re-drilling a solved variation via the picker behave exactly as it does today, and what makes a variation solved before this feature shipped never retroactively grow arrows.

## Data model changes

### New table: `variation_teaching_progress`

```sql
create table public.variation_teaching_progress (
  id             uuid primary key default gen_random_uuid(),
  player_id      uuid not null references public.profiles(id) on delete cascade,
  repertoire_id  uuid not null references public.repertoires(id) on delete cascade,
  variation_key  text not null,
  taught_plies   integer not null default 0,
  mastered_plies integer not null default 0,
  updated_at     timestamptz not null default now(),
  unique (player_id, variation_key)
);

create index variation_teaching_progress_player_repertoire_idx
  on public.variation_teaching_progress (player_id, repertoire_id);

alter table public.variation_teaching_progress enable row level security;

create policy "variation_teaching_progress_player_all" on public.variation_teaching_progress
  for all using (player_id = auth.uid());

create policy variation_teaching_progress_coach_read on public.variation_teaching_progress for select using (
  exists (
    select 1 from public.coach_players cp
    where cp.player_id = variation_teaching_progress.player_id
      and cp.coach_id = auth.uid()
      and cp.status = 'active'
  )
);

revoke all on public.variation_teaching_progress from anon, public;
```

Mirrors `variation_solved`'s exact shape and RLS pattern (migration `0045_remove_leveling_add_solved.sql`). No row means "nothing taught or mastered beyond the free zone yet" — the `Math.max(..., freeZone)` floor in the derivation above means the app never needs to distinguish "no row" from "a row with both counters at 0."

### New pure-logic module: `src/lib/mastery/teaching.ts`

```ts
import { FIRST_MOVES_GROUP_PLIES, type VariationStep } from './variations';

export type TeachingStep = {
	path: VariationStep[];
	arrowPlies: { from: number; to: number } | null;
	isFinalPass: boolean;
};

export function resolveTeachingStep(
	path: VariationStep[],
	taughtPlies: number,
	masteredPlies: number
): TeachingStep {
	const freeZone = Math.min(FIRST_MOVES_GROUP_PLIES, path.length);
	const taught = Math.max(taughtPlies, freeZone);
	const mastered = Math.max(masteredPlies, freeZone);

	if (mastered >= path.length) {
		return { path, arrowPlies: null, isFinalPass: true };
	}
	if (taught === mastered) {
		const target = Math.min(mastered + FIRST_MOVES_GROUP_PLIES, path.length);
		return { path: path.slice(0, target), arrowPlies: { from: mastered, to: target }, isFinalPass: false };
	}
	return { path: path.slice(0, taught), arrowPlies: null, isFinalPass: taught >= path.length };
}

export function advanceTeachingProgress(
	path: VariationStep[],
	taughtPlies: number,
	masteredPlies: number,
	hadMistake: boolean
): { taughtPlies: number; masteredPlies: number; solved: boolean } {
	const step = resolveTeachingStep(path, taughtPlies, masteredPlies);
	if (hadMistake) {
		return { taughtPlies, masteredPlies, solved: false };
	}
	if (step.arrowPlies) {
		return { taughtPlies: step.arrowPlies.to, masteredPlies, solved: false };
	}
	return { taughtPlies: Math.max(taughtPlies, step.path.length), masteredPlies: step.path.length, solved: step.isFinalPass };
}
```

`resolveTeachingStep` is used when serving an attempt (read path); `advanceTeachingProgress` is used when recording its outcome (write path) — it re-derives the same step the player was actually just served (deterministically, from the same stored counters) rather than trusting anything the client reports, matching how `hadMistake` is already the only client-reported fact about an attempt today.

## Server-side changes

### `src/lib/server/practice-progress.ts`

Two new functions, mirroring `loadSolvedKeys`'s existing per-repertoire shape:

- `loadTeachingProgress(supabase, playerId, repertoireId): Promise<Map<string, { taughtPlies: number; masteredPlies: number }>>` — one `select` filtered by `player_id`/`repertoire_id`, keyed by `variation_key`.
- `saveTeachingProgress(supabase, playerId, repertoireId, variationKey, taughtPlies, masteredPlies): Promise<void>` — upsert on `(player_id, variation_key)`.

`applyAttemptResult` changes to: look up the attempted variation's `path` from the `variations` array it's already given; if the variation is not already solved, load its teaching-progress row, call `advanceTeachingProgress`, and persist the result via `saveTeachingProgress`. Only when that call reports `solved: true` does it fall through to the existing `markVariationSolved` + `advanceIfSolved` + `setActiveVariationKey` sequence, unchanged. If the variation is already solved (re-drill), or isn't found in `variations` (defensive), behavior is exactly as it is today — `hadMistake` alone gates `markVariationSolved`.

### `src/lib/mastery/practice.ts`

`PracticeView.attempt` gains two fields:

```ts
attempt: { path: VariationStep[]; variationKey: string; arrowPlies: { from: number; to: number } | null; isFinalPass: boolean } | null;
```

`buildPracticeView` gains a new parameter, `teachingProgress: ReadonlyMap<string, { taughtPlies: number; masteredPlies: number }>`, inserted before the existing `forceAttempt` parameter. After picking the active variation, if it's already solved (or `forceAttempt` re-drilling a solved one) it's served at full depth with `arrowPlies: null, isFinalPass: true`, exactly as today; otherwise its served path/arrow range come from `resolveTeachingStep(active.path, progress.taughtPlies ?? 0, progress.masteredPlies ?? 0)`.

### Call sites

`/api/practice/attempt`, `/api/practice/select-variation`, and the practice detail page's `+page.server.ts` load function each call `buildPracticeView` today — each needs to additionally `loadTeachingProgress(...)` alongside its existing `loadSolvedKeys(...)` call and thread the result through.

### `PracticeView.solved`'s optimistic client-side bump

`optimisticSolvedAfterAttempt` (`src/lib/mastery/practice.ts`) currently bumps the sidebar count on any clean attempt. With teaching batches, a clean teach or intermediate blind-retest pass must NOT bump it — only a clean pass where the server would report `solved: true`. The `+page.svelte` call site gates the existing bump on `attempt.isFinalPass` in addition to `!attemptHadMistake`.

## Client-side changes

### `ChessBoard.svelte`

New prop: `arrowMove?: { from: Key; to: Key } | null`. A new shape-building function alongside the existing `feedbackShapes()` returns `[{ orig: arrowMove.from, dest: arrowMove.to, brush: 'yellow' }]` when set (chessground's native arrow rendering via `orig`+`dest`, the same mechanism already available and already imported — no new dependency). `buildConfig()`'s `drawable.autoShapes` becomes the concatenation of the arrow shape and `feedbackShapes()`; the `$effect` that re-applies config on prop changes already re-runs `buildConfig()`, so it picks up `arrowMove` changes for free once it's a tracked prop. The post-move `cg.set({ drawable: { autoShapes: feedbackShapes() } })` calls inside the `movable.events.after` handler are unchanged — they intentionally show only the check/cross/star badge for the hold, replacing the arrow rather than showing both.

### `+page.svelte`

A new derived value, following the same pattern as the existing `hintSquare`:

```ts
const arrowMove = $derived.by(() => {
	const range = attempt?.arrowPlies;
	if (!range || quizIdx < range.from || quizIdx >= range.to) return null;
	const step = quizSteps[quizIdx];
	if (!step || !step.isPlayerTurn) return null;
	try {
		const move = new Chess(step.fromFen).move(step.san);
		return move ? { from: move.from as Key, to: move.to as Key } : null;
	} catch {
		return null;
	}
});
```

Passed to `<ChessBoard ... {arrowMove} />`. No change to `resetForAttempt()` or `advanceThroughOpponentReplies()` — both already treat `quizSteps`/`attempt.path` generically regardless of length, so a batch-truncated path (shorter than the variation's full leaf path) plays exactly like a shorter variation always has.

## Edge cases

- **Variations no longer than `FIRST_MOVES_GROUP_PLIES` (10 plies / 5 moves):** `resolveTeachingStep`'s `freeZone` equals `path.length`, so `mastered >= path.length` is true from the very first attempt — never taught, behaves exactly as today. No special-casing needed; this falls out of the same formula as every other case.
- **Already-solved variations (including pre-feature ones):** bypassed unconditionally by the `solvedKeys` check in `buildPracticeView`, before `teachingProgress` is even consulted — see Architecture. No migration backfill of `variation_teaching_progress` is needed.
- **Manually re-picking an unsolved, partially-taught variation via the picker:** `variation_teaching_progress` is keyed only by `(player, variation_key)`, independent of which variation is "active" — picking it resumes its stored `taught_plies`/`mastered_plies` exactly where they were left, whether that variation was reached automatically or manually.
- **A mistake during a teach pass:** `advanceTeachingProgress` leaves both counters unchanged on `hadMistake`, so the identical teach pass (same arrow range) is re-served next attempt — the player isn't asked to blind-guess a batch that was interrupted mid-teaching.
- **A mistake during a blind-retest (including the final pass):** same mechanism — counters unchanged, the same blind-retest is re-served, matching the confirmed "just retry, no re-teaching" behavior.

## Testing

- Pure-logic tests (`src/lib/mastery/teaching.test.ts`) for `resolveTeachingStep` and `advanceTeachingProgress`: the free-zone floor for a fresh variation, a mid-batch teach pass, a clean teach pass advancing `taught_plies` only, a clean blind-retest advancing `masteredPlies` only, a mistake leaving both counters untouched in both phases, the final batch's blind-retest reporting `isFinalPass`/`solved: true`, and a variation shorter than `FIRST_MOVES_GROUP_PLIES` never leaving the terminal state.
- `practice.test.ts`: `buildPracticeView` tests extended with a `teachingProgress` map — an untaught variation gets the right truncated path + arrow range, an already-solved variation ignores a stale/partial `teachingProgress` entry entirely, and existing tests are updated to pass an empty map.
- `practice-progress.test.ts` (server-side, fake-supabase style already used there): `applyAttemptResult` tests for each of the three transitions (teach→taught, blind-retest→mastered, final→solved) confirming `variation_solved`/`practice_active_variation` are untouched until the final transition.
- Component test (`ChessBoard.test.ts` or equivalent, if one exists — otherwise a new focused test): `arrowMove` renders a chessground arrow shape (`orig`+`dest`) when set, and clears when `null`.
- Manual end-to-end verification: practice a fresh variation longer than 10 plies, confirm no arrow for the first 5 moves, an arrow for each move 6–10 on first exposure, a blind (arrow-free) full replay required afterward, and — for a variation longer than 15 moves — the same teach/retest cycle repeating for the next batch.
